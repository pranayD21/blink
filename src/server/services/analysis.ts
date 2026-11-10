/**
 * Persistence half of the analysis pipeline (§10.4, §10.5): takes grounded
 * claims, reconciles them with the claims already on the case, stores
 * processing issues and AI-suggested concerns, runs the public-evidence
 * comparison, and re-evaluates the case — in one transaction.
 *
 * The model call itself lives in the job handler; nothing here is async.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { hashOf } from "@/core/deps/hash";
import { type LineageRow, diffTurns, planClaimMatch } from "@/core/evidence/lineage";
import type { GroundedClaim, GroundingResult } from "@/core/extraction/ground";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, toJson } from "../db/client";
import { analysisRuns, claimQuotes, claims, processingIssues } from "../db/schema";
import { newId } from "../ids";
import { applyCaseEvent } from "./caseStatus";
import { insertClaimVersion, supersedeClaim } from "./claimsCore";
import { reevaluateCase, runComparison } from "./evaluation";
import { createFinding, openTask } from "./findingsCore";
import { type ClaimMeta, type TranscriptRow, activePolicyVersion, currentPacket, getCase, isEvaluable, loadCurrentClaims, turnsOfVersion } from "./loaders";

export type RunRow = typeof analysisRuns.$inferSelect;

export function startRun(tx: DbOrTx, input: { caseId: string; transcript: TranscriptRow; model: string; promptVersion: string; source: "ai" | "gold" }): RunRow {
  const caseRow = getCase(tx, input.caseId);
  const runNo = (tx.select({ max: sql<number | null>`max(${analysisRuns.runNo})` }).from(analysisRuns).where(eq(analysisRuns.caseId, input.caseId)).get()?.max ?? 0) + 1;
  const row: RunRow = {
    id: newId("run"),
    caseId: input.caseId,
    runNo,
    transcriptVersionId: input.transcript.id,
    packetId: currentPacket(tx, input.caseId).id,
    // Pin what this run was evaluated against (§3.2 rule 5).
    policyVersionId: caseRow.activePolicyVersionId ?? activePolicyVersion(tx)?.id ?? null,
    documentSetId: caseRow.documentSetId,
    model: input.model,
    promptVersion: input.promptVersion,
    source: input.source,
    status: "running",
    stage: "Parsing",
    error: null,
    reportJson: null,
    callSummary: null,
    llmCallId: null,
    startedAt: nowIso(),
    finishedAt: null,
  };
  tx.insert(analysisRuns).values(row).run();
  appendAudit(tx, { actorId: "system", type: "ANALYSIS_STARTED", entityType: "analysis_run", entityId: row.id, caseId: input.caseId, payload: { run: runNo, transcript_version: input.transcript.versionNo, policy_version: row.policyVersionId, document_set: row.documentSetId, model: row.model, prompt_version: row.promptVersion, source: row.source } });
  return row;
}

export function setRunStage(tx: DbOrTx, runId: string, stage: string): void {
  tx.update(analysisRuns).set({ stage }).where(eq(analysisRuns.id, runId)).run();
}

export function latestRun(db: DbOrTx, caseId: string): RunRow | null {
  return db.select().from(analysisRuns).where(eq(analysisRuns.caseId, caseId)).orderBy(desc(analysisRuns.runNo)).limit(1).get() ?? null;
}

export interface PersistAnalysisInput {
  caseId: string;
  runId: string;
  transcript: TranscriptRow;
  grounding: GroundingResult;
  llmCallId: string | null;
}

export interface AnalysisReport {
  stats: GroundingResult["stats"];
  rejected: GroundingResult["rejected"];
  claims: { created: string[]; revised: string[]; carried: string[]; retired: string[] };
  suggestedConcerns: number;
  issues: number;
  findingsOpened: number;
  stale: string[];
}

function addIssue(tx: DbOrTx, caseId: string, runId: string | null, severity: "blocking" | "warning", code: string, message: string, ref: Record<string, unknown> = {}): void {
  tx.insert(processingIssues).values({ id: newId("iss"), caseId, runId, severity, code, message, refJson: toJson(ref), resolved: false, createdAt: nowIso() }).run();
}

/** A blocking issue for a failed run. Refusals, truncation, and replay misses never fail silently (D5). */
export function recordAnalysisFailure(tx: DbOrTx, input: { caseId: string; runId: string | null; code: string; message: string }): void {
  addIssue(tx, input.caseId, input.runId, "blocking", input.code, input.message);
  if (input.runId) tx.update(analysisRuns).set({ status: "failed", stage: "Failed", error: `${input.code}: ${input.message}`, finishedAt: nowIso() }).where(eq(analysisRuns.id, input.runId)).run();
  applyCaseEvent(tx, getCase(tx, input.caseId), "ANALYSIS_FAILED", { actorId: "system", cause: input.code });
  appendAudit(tx, { actorId: "system", type: "ANALYSIS_FAILED", entityType: "analysis_run", entityId: input.runId ?? input.caseId, caseId: input.caseId, payload: { code: input.code, message: input.message } });
}

export function persistAnalysis(tx: DbOrTx, input: PersistAnalysisInput): AnalysisReport {
  const { caseId, runId, transcript, grounding } = input;
  const turnRows = turnsOfVersion(tx, transcript.id);
  const turnByLabel = new Map(turnRows.map((t) => [t.label, t]));

  // ── Reconcile with the claims already on the case (§10.4) ────────────────
  const existing = loadCurrentClaims(tx, caseId).filter((c) => c.row.status !== "rejected");
  // Claims still quote the transcript version they were extracted from. Align that version with this one
  // directly, so the plan is right even if an intermediate version was never analyzed. A re-run on the
  // same version is the identity.
  const priorVersionId = existing.flatMap((c) => c.quotes).map((q) => q.turnId.slice(0, q.turnId.lastIndexOf(":"))).find((id) => id !== transcript.id);
  const lineage: LineageRow[] = priorVersionId
    ? diffTurns(
        turnsOfVersion(tx, priorVersionId).map((t) => ({ label: t.label, speaker: t.speaker, text: t.text, textHash: t.textHash })),
        turnRows.map((t) => ({ label: t.label, speaker: t.speaker, text: t.text, textHash: t.textHash })),
      )
    : turnRows.map((t) => ({ oldLabel: t.label, newLabel: t.label, change: "same" as const }));

  const { plans, keyMap } = planClaimMatch(
    existing.map((c) => ({ logicalKey: c.row.logicalKey, quotes: c.quotes.map((q) => ({ turnLabel: q.turnLabel, start: q.start, end: q.end })) })),
    grounding.claims.map((c) => ({ logicalKey: c.logicalKey, quotes: c.quotes.map((q) => ({ turnLabel: q.turnLabel, start: q.start, end: q.end })) })),
    lineage,
  );
  const mapKey = (k: string) => keyMap[k] ?? k;
  const groundedByKey = new Map(grounding.claims.map((c) => [c.logicalKey, c]));
  const existingByKey = new Map(existing.map((c) => [c.row.logicalKey, c]));
  const oldToNewLabel = new Map(lineage.filter((r) => r.oldLabel && r.newLabel).map((r) => [r.oldLabel!, r.newLabel!]));
  const questionsFor = (newKey: string) => grounding.missingContextQuestions.filter((q) => q.claimKey === newKey).map((q) => q.question);

  const metaOf = (g: GroundedClaim): ClaimMeta => ({ solicitedByAnalyst: g.solicitedByAnalyst, fieldUncertainty: g.fieldUncertainty, conflictFields: g.conflictFields, ungroundedFields: g.ungroundedFields, aiQuestions: questionsFor(g.logicalKey) });
  const quotesOf = (g: GroundedClaim) =>
    g.quotes.map((q) => ({ turnId: turnByLabel.get(q.turnLabel)!.id, turnTextHash: q.turnTextHash, quote: q.quote, start: q.start, end: q.end, role: q.role, supportsFields: q.supportsFields, normalized: q.normalized }));
  const linksOf = (g: GroundedClaim) => g.links.map((l) => ({ linkedLogicalKey: mapKey(l.to), kind: l.kind }));
  const fieldsOf = (g: GroundedClaim) => ({ ...g.fields, is_correction_of: g.fields.is_correction_of ? mapKey(g.fields.is_correction_of) : null });

  const report: AnalysisReport = { stats: grounding.stats, rejected: grounding.rejected, claims: { created: [], revised: [], carried: [], retired: [] }, suggestedConcerns: 0, issues: 0, findingsOpened: 0, stale: [] };
  const changedKeys = new Set<string>();

  for (const plan of plans) {
    if (plan.action === "create") {
      const g = groundedByKey.get(plan.newKey)!;
      insertClaimVersion(tx, { caseId, runId, logicalKey: plan.logicalKey, versionNo: 1, status: "proposed", asserted: fieldsOf(g), verified: null, meta: metaOf(g), quotes: quotesOf(g), links: linksOf(g) });
      report.claims.created.push(plan.logicalKey);
      changedKeys.add(plan.logicalKey);
    } else if (plan.action === "revise") {
      const old = existingByKey.get(plan.oldKey)!;
      const g = groundedByKey.get(plan.newKey)!;
      // Reviewer-verified values are the reviewer's, not the model's: keep them. The hash still changes, so dependents reopen.
      const row = insertClaimVersion(tx, { caseId, runId, logicalKey: plan.logicalKey, versionNo: old.row.versionNo + 1, status: old.record.verified ? "reviewer_corrected" : "proposed", asserted: fieldsOf(g), verified: old.record.verified, meta: metaOf(g), quotes: quotesOf(g), links: linksOf(g) });
      supersedeClaim(tx, old.row.id, row.id);
      report.claims.revised.push(plan.logicalKey);
      changedKeys.add(plan.logicalKey);
    } else if (plan.action === "carry") {
      // Evidence unchanged: keep the row as it is. Only re-point its quotes at the new version's turns.
      const old = existingByKey.get(plan.oldKey)!;
      for (const q of old.quotes) {
        const target = turnByLabel.get(oldToNewLabel.get(q.turnLabel) ?? q.turnLabel);
        if (target && target.id !== q.turnId) tx.update(claimQuotes).set({ turnId: target.id }).where(eq(claimQuotes.id, q.id)).run();
      }
      report.claims.carried.push(plan.logicalKey);
    } else {
      const old = existingByKey.get(plan.oldKey)!;
      const meta: ClaimMeta = { ...old.meta, retiredReason: `its quoted text was changed or removed in transcript v${transcript.versionNo} and the new analysis found no matching statement` };
      tx.update(claims).set({ status: "rejected", metaJson: toJson(meta) }).where(eq(claims.id, old.row.id)).run();
      addIssue(tx, caseId, runId, "warning", "CLAIM_RETIRED", `claim ${plan.logicalKey} was retired: ${meta.retiredReason}`, { claim: plan.logicalKey });
      report.claims.retired.push(plan.logicalKey);
      report.issues++;
    }
  }

  // ── Processing issues from grounding (§10.3) ─────────────────────────────
  for (const issue of grounding.issues) {
    addIssue(tx, caseId, runId, issue.severity, issue.code, issue.message, { ...issue.ref, ...(issue.ref.claim ? { claim: mapKey(issue.ref.claim) } : {}) });
    report.issues++;
  }
  // A successful run supersedes earlier run-level failures.
  tx.update(processingIssues)
    .set({ resolved: true })
    .where(and(eq(processingIssues.caseId, caseId), eq(processingIssues.severity, "blocking"), eq(processingIssues.resolved, false), sql`(${processingIssues.code} LIKE 'LLM%' OR ${processingIssues.code} = 'ANALYSIS_ERROR')`))
    .run();

  // ── Public-evidence comparison for every claim it applies to (§10.5) ─────
  const current = loadCurrentClaims(tx, caseId);
  for (const claim of current.filter(isEvaluable)) runComparison(tx, caseId, claim);

  // ── AI-suggested concerns: labeled, can open work, never auto-closed ─────
  for (const concern of grounding.suggestedConcerns) {
    const keys = concern.claimKeys.map(mapKey);
    // A concern about claims carried over unchanged was already raised by the earlier run.
    if (keys.length > 0 && !keys.some((k) => changedKeys.has(k))) continue;
    const { finding, created } = createFinding(tx, {
      caseId,
      claimLogicalKey: keys[0] ?? null,
      origin: "ai_suggested",
      title: concern.title,
      severity: "medium",
      state: "REVIEW_REQUIRED",
      reasonCodes: ["AI_SUGGESTED"],
      explanation: concern.rationale,
      dedupeKey: `ai:${caseId}:${hashOf({ title: concern.title.toLowerCase(), keys: [...keys].sort() }).slice(0, 16)}`,
      createdBy: "system",
      auditPayload: { claims: keys, run: runId },
    });
    if (created) {
      openTask(tx, { caseId, findingId: finding.id, kind: "review", question: `Review this AI-suggested concern: ${concern.title}`, assignedRole: "reviewer", dedupeKey: `ai-review:${finding.id}`, meta: { aiSuggested: true }, actorId: "system" });
      report.suggestedConcerns++;
      report.findingsOpened++;
    }
  }

  // ── Evaluate policy, then staleness and status ───────────────────────────
  applyCaseEvent(tx, getCase(tx, caseId), "ANALYSIS_SUCCEEDED", { actorId: "system", cause: "analysis finished" });
  const evaluation = reevaluateCase(tx, caseId, { actorId: "system", reason: "analysis", eventType: "CLAIM_EVALUATED", eventToken: `run:${runId}`, runId });
  report.findingsOpened += evaluation.findingsOpened;
  report.stale = evaluation.stale.map((s) => `${s.label}: ${s.reason}`);

  tx.update(analysisRuns)
    .set({ status: "succeeded", stage: "Done", reportJson: toJson(report), callSummary: grounding.callSummary, llmCallId: input.llmCallId, policyVersionId: evaluation.policyVersionId, finishedAt: nowIso() })
    .where(eq(analysisRuns.id, runId))
    .run();
  appendAudit(tx, {
    actorId: "system",
    type: "ANALYSIS_COMPLETED",
    entityType: "analysis_run",
    entityId: runId,
    caseId,
    payload: { claims: report.claims, quotes: { proposed: grounding.stats.proposedQuotes, valid: grounding.stats.validQuotes, dropped: grounding.stats.droppedQuotes }, rejected_claims: grounding.rejected.length, suggested_concerns: report.suggestedConcerns, findings_opened: report.findingsOpened, stale: report.stale },
  });
  return report;
}
