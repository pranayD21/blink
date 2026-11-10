/**
 * GET /api/cases/:id/workspace — everything the review screen needs in one
 * payload (§14, §15.2). Reviewers only: analysts may never read findings or
 * quotes of restricted claims.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { ComparisonResult } from "@/core/evidence/compare";
import { guardToEnglish } from "@/core/policy/decompile";
import { effectiveFields } from "@/core/predicates/evaluate";
import type { PublicMatchFact } from "@/core/predicates/registry";
import type { GuardTraceNode } from "@/core/runtime/monitorReducer";
import type { ClaimFields } from "@/core/types";
import type { ReadinessBlocker } from "@/core/workflow/case";
import { type HiddenStatus, hiddenStatus } from "@/core/workflow/brief";
import { aggregateMonitorStates, statePath } from "@/core/workflow/finding";
import { type Actor, isReviewer } from "../auth/actor";
import { type AuditEventView, listAudit } from "../audit/log";
import { type DbOrTx, fromJson } from "../db/client";
import { analysisRuns, decisions, dependencies, findings, jobs, llmCalls, monitorEvaluations, monitorInstances, predicateAssessments, processingIssues, tasks, transcriptVersions, turnLineage, turns, users } from "../db/schema";
import { forbidden } from "../errors";
import { type JobView, toJobView } from "../jobs/queue";
import { llmMode } from "../llm/client";
import { latestBrief } from "./briefs";
import { eligibilityForCase } from "./briefs";
import { packetView } from "./cases";
import { turnPlacer } from "./placement";
import { computeReviewBlockers, latestAttestation } from "./caseStatus";
import { escalationRequired, findingLabel } from "./findingsCore";
import { type ClaimMeta, type LoadedClaim, currentTranscript, getCase, loadCurrentClaims, loadPolicy, loadPublicMatch, turnsOfVersion } from "./loaders";

export interface MonitorHistoryStep {
  seq: number;
  eventType: string;
  eventId: string;
  turnLabel: string | null;
  prevState: string;
  nextState: string;
  result: string;
  transitionId: string | null;
  effects: string[];
  conflictFlag: boolean;
  createdAt: string;
}

export interface ClaimMonitorView {
  monitorId: string;
  ruleId: string;
  state: string;
  history: MonitorHistoryStep[];
  /** The latest evaluation's guard trace and leaf explanations. */
  trace: GuardTraceNode | null;
  assessments: Record<string, { state: string; explanation: string }>;
}

export interface ClaimView {
  id: string;
  logicalKey: string;
  versionNo: number;
  status: string;
  contentHash: string;
  fields: ClaimFields;
  asserted: ClaimFields;
  verified: Partial<ClaimFields> | null;
  fieldSources: Record<string, "asserted" | "verified">;
  meta: ClaimMeta;
  quotes: { id: string; turnId: string; turnLabel: string; turnIdx: number; quote: string; start: number; end: number; role: string; normalized: boolean; supportsFields: string[] }[];
  links: { linkedLogicalKey: string; kind: string }[];
  correctedBy: string[];
  turnLabels: string[];
  comparison: ComparisonResult | null;
  publicMatch: PublicMatchFact | null;
  reviewerMatch: { verdict: string; note: string; actorId: string; at: string } | null;
  assessments: { key: string; state: string; explanation: string }[];
  monitors: ClaimMonitorView[];
  eligibility: { eligible: boolean; reason: string | null; detail: string | null };
}

export interface FindingView {
  id: string;
  label: string;
  claimLogicalKey: string | null;
  origin: string;
  title: string;
  severity: string;
  state: string;
  version: number;
  explanation: string;
  reasonCodes: string[];
  missingContext: { ruleId: string; monitorId: string; predicate: string; state: string; question: string; explanation: string }[];
  turnLabels: string[];
  primaryTurnLabel: string | null;
  /** What happens to this finding's passages: hidden until compliance decides, kept hidden, or shown to the banker on release. */
  hidden: HiddenStatus;
  /** A `live` finding's hidden words, on the current transcript. Empty for every other finding. */
  passages: { turnLabel: string; text: string }[];
  rules: { ruleId: string; state: string }[];
  /** Mini FSM path of the claim's monitors, e.g. UNASSESSED → NEEDS_CONTEXT → REVIEW_REQUIRED, with the turn each step happened at. */
  path: { state: string; turnLabel: string | null }[];
  escalationRequired: boolean;
  tasks: { id: string; kind: string; status: string; question: string; answer: string | null; assignedRole: string; version: number; meta: Record<string, unknown>; createdAt: string; closedAt: string | null }[];
  decisions: { id: string; kind: string; outcome: string | null; rationale: string; actorId: string; evidenceHash: string; stale: boolean; staleReason: string | null; createdAt: string; evidence: { sourceType: string; sourceLabel: string; sourceHash: string }[] }[];
  history: { seq: number; ts: string; type: string; actorId: string; payload: Record<string, unknown> }[];
  createdAt: string;
}

export interface WorkspacePayload {
  viewer: Actor;
  llmMode: string;
  case: { id: string; title: string; issuer: string; ticker: string; status: string; version: number; createdAt: string };
  packet: ReturnType<typeof packetView>;
  policy: {
    id: string;
    label: string;
    status: string;
    compileSource: string;
    title: string;
    rules: { ruleId: string; monitorId: string | null; intent: string; severity: string; onTrue: string; onIndeterminate: string; guardEnglish: string; sourceClauses: { id: string; paragraph: string; verbatim: string }[] }[];
  } | null;
  run: { id: string; runNo: number; status: string; stage: string; source: string; model: string; promptVersion: string; replayed: boolean; recordedAt: string | null; report: Record<string, unknown> | null; startedAt: string; finishedAt: string | null; error: string | null } | null;
  job: JobView | null;
  transcript: {
    id: string;
    versionNo: number;
    sourceLabel: string;
    createdAt: string;
    turns: { id: string; label: string; idx: number; speaker: string; speakerName: string; timestamp: string | null; text: string; change: string | null }[];
    removedTurns: { label: string; text: string }[];
    versions: { id: string; versionNo: number; sourceLabel: string; createdAt: string }[];
  } | null;
  claims: ClaimView[];
  findings: FindingView[];
  issues: { id: string; severity: string; code: string; message: string; ref: Record<string, unknown>; resolved: boolean; createdAt: string }[];
  attestation: { id: string; actorId: string; transcriptVersionId: string; stale: boolean; staleReason: string | null; createdAt: string; evidenceHash: string; current: boolean } | null;
  brief: { id: string; versionNo: number; status: string } | null;
  blockers: ReadinessBlocker[];
  users: Record<string, string>;
}

function monitorViews(tx: DbOrTx, caseId: string, policyVersionId: string | null): Map<string, ClaimMonitorView[]> {
  const out = new Map<string, ClaimMonitorView[]>();
  if (!policyVersionId) return out;
  const instances = tx.select().from(monitorInstances).where(and(eq(monitorInstances.caseId, caseId), eq(monitorInstances.policyVersionId, policyVersionId))).all();
  if (instances.length === 0) return out;
  const evals = tx.select().from(monitorEvaluations).where(inArray(monitorEvaluations.instanceId, instances.map((i) => i.id))).orderBy(asc(monitorEvaluations.seq)).all();
  for (const instance of instances) {
    const rows = evals.filter((e) => e.instanceId === instance.id);
    const last = rows[rows.length - 1];
    const lastTrace = last ? fromJson<{ trace: GuardTraceNode; assessments: Record<string, { state: string; explanation: string }> } | null>(last.guardTraceJson, null) : null;
    const view: ClaimMonitorView = {
      monitorId: instance.monitorId,
      ruleId: instance.ruleId,
      state: instance.state,
      history: rows.map((e) => ({ seq: e.seq, eventType: e.eventType, eventId: e.eventId, turnLabel: e.turnLabel, prevState: e.prevState, nextState: e.nextState, result: e.result, transitionId: e.transitionId, effects: fromJson<string[]>(e.effectsJson, []), conflictFlag: e.conflictFlag, createdAt: e.createdAt })),
      trace: lastTrace?.trace ?? null,
      assessments: Object.fromEntries(Object.entries(lastTrace?.assessments ?? {}).map(([k, a]) => [k, { state: a.state, explanation: a.explanation }])),
    };
    out.set(instance.claimLogicalKey, [...(out.get(instance.claimLogicalKey) ?? []), view]);
  }
  for (const list of out.values()) list.sort((a, b) => (a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0));
  return out;
}

/** The claim's aggregate monitor state after each event, in order: the "mini FSM path". */
function aggregatePath(monitors: ClaimMonitorView[]): { state: string; turnLabel: string | null }[] {
  if (monitors.length === 0) return [];
  const events: { eventId: string; turnLabel: string | null; order: string }[] = [];
  for (const m of monitors) {
    for (const h of m.history) {
      if (!events.some((e) => e.eventId === h.eventId)) events.push({ eventId: h.eventId, turnLabel: h.turnLabel, order: `${h.createdAt}:${String(h.seq).padStart(6, "0")}` });
    }
  }
  events.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const current = new Map(monitors.map((m) => [m.monitorId, "UNASSESSED"]));
  const steps: { state: string; turnLabel: string | null }[] = [{ state: "UNASSESSED", turnLabel: null }];
  for (const event of events) {
    for (const m of monitors) {
      const h = m.history.find((x) => x.eventId === event.eventId);
      if (h) current.set(m.monitorId, h.nextState);
    }
    steps.push({ state: aggregateMonitorStates([...current.values()]), turnLabel: event.turnLabel });
  }
  const collapsed = statePath(steps.map((s) => s.state));
  // Keep the turn label of the step at which each state was first reached.
  let cursor = 0;
  return collapsed.map((state) => {
    while (steps[cursor].state !== state) cursor++;
    return steps[cursor];
  });
}

function claimView(claim: LoadedClaim, tx: DbOrTx, caseId: string, monitors: ClaimMonitorView[], correctedBy: string[], eligibility: ClaimView["eligibility"]): ClaimView {
  const match = loadPublicMatch(tx, caseId, { logicalKey: claim.row.logicalKey, contentHash: claim.row.contentHash });
  const assessments = tx.select().from(predicateAssessments).where(eq(predicateAssessments.claimId, claim.row.id)).all();
  return {
    id: claim.row.id,
    logicalKey: claim.row.logicalKey,
    versionNo: claim.row.versionNo,
    status: claim.row.status,
    contentHash: claim.row.contentHash,
    fields: claim.fields,
    asserted: claim.record.asserted,
    verified: claim.record.verified,
    fieldSources: effectiveFields(claim.record).sources,
    meta: claim.meta,
    quotes: claim.quotes.map((q) => ({ id: q.id, turnId: q.turnId, turnLabel: q.turnLabel, turnIdx: q.turnIdx, quote: q.quote, start: q.start, end: q.end, role: q.role, normalized: q.normalized, supportsFields: q.supportsFields })),
    links: claim.links,
    correctedBy,
    turnLabels: claim.turnLabels,
    comparison: match.comparison,
    publicMatch: match.fact,
    reviewerMatch: match.reviewer ? { verdict: match.reviewer.verdict, note: match.reviewer.note, actorId: match.reviewer.actorId, at: match.reviewer.at } : null,
    assessments: assessments.map((a) => ({ key: a.predicate, state: a.state, explanation: a.explanation })).sort((a, b) => (a.key < b.key ? -1 : 1)),
    monitors,
    eligibility,
  };
}

export function loadWorkspace(tx: DbOrTx, caseId: string, actor: Actor): WorkspacePayload {
  if (!isReviewer(actor)) throw forbidden("the review workspace is for compliance reviewers. Analysts see released briefs on the Analyst page.");
  const caseRow = getCase(tx, caseId);
  const policy = caseRow.activePolicyVersionId ? loadPolicy(tx, caseRow.activePolicyVersionId) : null;
  const transcript = currentTranscript(tx, caseId);

  // Transcript, with what changed against the previous version.
  let transcriptView: WorkspacePayload["transcript"] = null;
  if (transcript) {
    const turnRows = turnsOfVersion(tx, transcript.id);
    const lineage = tx.select().from(turnLineage).where(eq(turnLineage.transcriptVersionId, transcript.id)).all();
    const changeOf = new Map(lineage.filter((l) => l.newTurnId).map((l) => [l.newTurnId!, l.change]));
    const removedIds = lineage.filter((l) => l.change === "removed" && l.oldTurnId).map((l) => l.oldTurnId!);
    const removed = removedIds.length > 0 ? tx.select().from(turns).where(inArray(turns.id, removedIds)).all() : [];
    transcriptView = {
      id: transcript.id,
      versionNo: transcript.versionNo,
      sourceLabel: transcript.sourceLabel,
      createdAt: transcript.createdAt,
      turns: turnRows.map((t) => ({ id: t.id, label: t.label, idx: t.idx, speaker: t.speaker, speakerName: t.speakerName, timestamp: t.timestamp, text: t.text, change: changeOf.get(t.id) ?? null })),
      removedTurns: removed.map((t) => ({ label: t.label, text: t.text })),
      versions: tx.select().from(transcriptVersions).where(eq(transcriptVersions.caseId, caseId)).orderBy(asc(transcriptVersions.versionNo)).all().map((v) => ({ id: v.id, versionNo: v.versionNo, sourceLabel: v.sourceLabel, createdAt: v.createdAt })),
    };
  }

  // Claims.
  const claims = loadCurrentClaims(tx, caseId);
  const monitorsByClaim = monitorViews(tx, caseId, policy?.version.id ?? null);
  const placer = turnPlacer(tx, caseId);
  const eligibility = eligibilityForCase(tx, caseId, placer);
  const stateOf = new Map(eligibility.findings.map((f) => [f.id, f]));
  const eligibilityByKey = new Map(eligibility.claims.map((c) => [c.claim.row.logicalKey, c.eligibility]));
  const claimViews = claims.map((claim) => {
    const e = eligibilityByKey.get(claim.row.logicalKey);
    const correctedBy = claims.filter((other) => other.fields.is_correction_of === claim.row.logicalKey).map((other) => other.row.logicalKey);
    return claimView(claim, tx, caseId, monitorsByClaim.get(claim.row.logicalKey) ?? [], correctedBy, e ? { eligible: e.eligible, reason: e.eligible ? null : e.reason, detail: e.eligible ? null : e.detail } : { eligible: false, reason: "not_evaluated", detail: "not an expert claim" });
  });
  const claimByKey = new Map(claimViews.map((c) => [c.logicalKey, c]));

  // Findings, with their tasks, decisions, and audit history.
  const findingRows = tx.select().from(findings).where(eq(findings.caseId, caseId)).orderBy(asc(findings.seqNo)).all();
  const taskRows = tx.select().from(tasks).where(eq(tasks.caseId, caseId)).orderBy(asc(tasks.createdAt), asc(tasks.id)).all();
  const decisionRows = tx.select().from(decisions).where(eq(decisions.caseId, caseId)).orderBy(asc(decisions.createdAt), asc(decisions.id)).all();
  const depRows = decisionRows.length > 0 ? tx.select().from(dependencies).where(and(eq(dependencies.caseId, caseId), eq(dependencies.dependentType, "decision"))).all() : [];
  const audit: AuditEventView[] = listAudit(tx, caseId);

  const findingViews: FindingView[] = findingRows.map((f) => {
    const claim = f.claimLogicalKey ? claimByKey.get(f.claimLogicalKey) : undefined;
    const reasonCodes = fromJson<string[]>(f.reasonCodesJson, []);
    const turnFromCode = reasonCodes.filter((c) => c.startsWith("TURN:")).map((c) => c.slice(5));
    const turnLabels = claim ? claim.turnLabels : turnFromCode;
    const primary = claim?.quotes.find((q) => q.role === "primary")?.turnLabel ?? turnLabels[0] ?? null;
    const monitors = f.origin === "policy" && claim ? claim.monitors : [];
    const taskIds = new Set(taskRows.filter((t) => t.findingId === f.id).map((t) => t.id));
    const checked = stateOf.get(f.id);
    // Compliance reads the words a live finding hid, on the current transcript (an unplaceable one is shown as recorded).
    const passages = f.origin !== "live" ? [] : (checked?.passages ?? []).flatMap((p) => {
      const placed = placer.place(p.turnId, p.start, p.end);
      if (placed) return placed.map((x) => ({ turnLabel: x.turn.label, text: x.turn.text.slice(x.start, x.end) }));
      const text = placer.sourceText(p.turnId, p.start, p.end);
      return text === null ? [] : [{ turnLabel: placer.sourceLabel(p.turnId), text }];
    });
    return {
      id: f.id,
      label: findingLabel(f),
      claimLogicalKey: f.claimLogicalKey,
      origin: f.origin,
      title: f.title,
      severity: f.severity,
      state: f.state,
      version: f.version,
      explanation: f.explanation,
      reasonCodes,
      missingContext: fromJson<FindingView["missingContext"]>(f.missingContextJson, []),
      turnLabels,
      primaryTurnLabel: primary,
      hidden: checked ? hiddenStatus(checked) : "until_decided",
      passages,
      rules: monitors.filter((m) => m.state !== "NOT_TRIGGERED" && m.state !== "UNASSESSED").map((m) => ({ ruleId: m.ruleId, state: m.state })),
      path: aggregatePath(monitors),
      escalationRequired: escalationRequired(tx, f.id),
      tasks: taskRows.filter((t) => t.findingId === f.id).map((t) => ({ id: t.id, kind: t.kind, status: t.status, question: t.question, answer: t.answer, assignedRole: t.assignedRole, version: t.version, meta: fromJson<Record<string, unknown>>(t.metaJson, {}), createdAt: t.createdAt, closedAt: t.closedAt })),
      decisions: decisionRows
        .filter((d) => d.findingId === f.id)
        .map((d) => ({
          id: d.id,
          kind: d.kind,
          outcome: d.outcome,
          rationale: d.rationale,
          actorId: d.actorId,
          evidenceHash: d.evidenceHash,
          stale: d.stale,
          staleReason: d.staleReason,
          createdAt: d.createdAt,
          evidence: depRows.filter((x) => x.dependentId === d.id).map((x) => ({ sourceType: x.sourceType, sourceLabel: x.sourceLabel, sourceHash: x.sourceHash })),
        })),
      history: audit.filter((e) => (e.entityType === "finding" && e.entityId === f.id) || (e.entityType === "task" && taskIds.has(e.entityId))).map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, actorId: e.actorId, payload: e.payload })),
      createdAt: f.createdAt,
    };
  });

  // Latest run and its job.
  const run = tx.select().from(analysisRuns).where(eq(analysisRuns.caseId, caseId)).orderBy(desc(analysisRuns.runNo)).limit(1).get() ?? null;
  const call = run?.llmCallId ? tx.select().from(llmCalls).where(eq(llmCalls.id, run.llmCallId)).get() : null;
  const jobRow = tx
    .select()
    .from(jobs)
    .where(eq(jobs.type, "analyze_transcript"))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .all()
    .find((j) => fromJson<{ caseId?: string }>(j.payloadJson, {}).caseId === caseId);

  const attestation = latestAttestation(tx, caseId);
  const brief = latestBrief(tx, caseId);

  return {
    viewer: actor,
    llmMode: llmMode(),
    case: { id: caseRow.id, title: caseRow.title, issuer: caseRow.issuer, ticker: caseRow.ticker, status: caseRow.status, version: caseRow.version, createdAt: caseRow.createdAt },
    packet: packetView(tx, caseId),
    policy: policy
      ? {
          id: policy.version.id,
          label: policy.version.label,
          status: policy.version.status,
          compileSource: policy.version.compileSource,
          title: policy.title,
          rules: policy.rulesDoc.rules.map((rule) => ({
            ruleId: rule.rule_id,
            monitorId: policy.monitors.find((m) => m.rule_id === rule.rule_id)?.monitor_id ?? null,
            intent: rule.intent,
            severity: rule.severity,
            onTrue: rule.on_true,
            onIndeterminate: rule.on_indeterminate,
            guardEnglish: guardToEnglish(policy.rules.get(rule.rule_id)!.guard),
            sourceClauses: rule.source_clause_ids.map((id) => {
              const clause = policy.inventory?.clauses.find((c) => c.clause_id === id);
              return { id, paragraph: clause?.paragraph ?? "", verbatim: clause?.verbatim ?? "" };
            }),
          })),
        }
      : null,
    run: run
      ? { id: run.id, runNo: run.runNo, status: run.status, stage: run.stage, source: run.source, model: run.model, promptVersion: run.promptVersion, replayed: call?.replayed ?? false, recordedAt: call?.recordedAt ?? null, report: fromJson<Record<string, unknown> | null>(run.reportJson, null), startedAt: run.startedAt, finishedAt: run.finishedAt, error: run.error }
      : null,
    job: jobRow ? toJobView(jobRow) : null,
    transcript: transcriptView,
    claims: claimViews,
    findings: findingViews,
    issues: tx.select().from(processingIssues).where(eq(processingIssues.caseId, caseId)).orderBy(desc(processingIssues.createdAt)).all().map((i) => ({ id: i.id, severity: i.severity, code: i.code, message: i.message, ref: fromJson<Record<string, unknown>>(i.refJson, {}), resolved: i.resolved, createdAt: i.createdAt })),
    attestation: attestation ? { id: attestation.id, actorId: attestation.actorId, transcriptVersionId: attestation.transcriptVersionId, stale: attestation.stale, staleReason: attestation.staleReason, createdAt: attestation.createdAt, evidenceHash: attestation.evidenceHash, current: !attestation.stale && attestation.transcriptVersionId === transcript?.id } : null,
    brief: brief ? { id: brief.id, versionNo: brief.versionNo, status: brief.status } : null,
    blockers: computeReviewBlockers(tx, caseId),
    users: Object.fromEntries(tx.select().from(users).all().map((u) => [u.id, u.name])),
  };
}
