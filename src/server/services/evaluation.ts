/**
 * Policy evaluation for a case (§9.1 `reevaluateCase`, §11 comparison).
 *
 * Loads rows, calls the pure core (comparator, predicates, monitor reducer),
 * and writes assessments, monitor evaluations, findings, and tasks plus audit
 * events — all inside the caller's transaction. No model is involved: at
 * runtime, code decides every policy outcome.
 */
import { and, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { contextFactHash } from "@/core/deps/hash";
import { type ComparisonResult, compareClaim, isComparable } from "@/core/evidence/compare";
import { getPredicate } from "@/core/predicates/registry";
import { type ClaimEvaluation, type MonitorRun, type MonitorStep, evaluateClaim } from "@/core/runtime/evaluateClaim";
import { traceLeaves } from "@/core/runtime/monitorReducer";
import type { ClaimFields, Severity } from "@/core/types";
import { type MonitorAggregate, aggregateMonitorStates, initialFindingState, monitorEventFor } from "@/core/workflow/finding";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, toJson } from "../db/client";
import { cases, contextFacts, findings, monitorEvaluations, monitorInstances, predicateAssessments, processingIssues } from "../db/schema";
import { newId } from "../ids";
import { syncCaseStatus } from "./caseStatus";
import { type FindingRow, SYSTEM_GUARD, applyFindingEvent, closeTask, createFinding, findingLabel, openTask, openTasksOf, updateFindingSummary } from "./findingsCore";
import { type LoadedClaim, type LoadedPolicy, activePolicyVersion, getCase, isEvaluable, loadCaseBundle, loadCurrentClaims, loadDocumentSet, loadPolicy, loadPublicMatch, publicMatchKey } from "./loaders";
import { type StaleOutcome, runStalenessPass } from "./staleness";

// ── Public-evidence comparison (§11) ────────────────────────────────────────

/**
 * Compares one claim with the case's document set and stores the result as
 * the comparator's context fact. An unchanged result keeps the existing row,
 * so decisions that depend on it stay fresh.
 */
export function runComparison(tx: DbOrTx, caseId: string, claim: LoadedClaim): ComparisonResult | null {
  const bundle = loadCaseBundle(tx, caseId);
  const key = publicMatchKey(claim.row.logicalKey);
  const existing = tx
    .select()
    .from(contextFacts)
    .where(and(eq(contextFacts.caseId, caseId), eq(contextFacts.key, key), eq(contextFacts.source, "comparison"), isNull(contextFacts.supersededBy)))
    .orderBy(desc(contextFacts.createdAt))
    .get();

  if (!isComparable(claim.fields, bundle.ctx)) {
    // The claim is no longer something to look up (e.g. corrected to an industry statement).
    if (existing) tx.update(contextFacts).set({ supersededBy: "not_comparable" }).where(eq(contextFacts.id, existing.id)).run();
    return null;
  }
  const { comparable } = loadDocumentSet(tx, bundle.caseRow.documentSetId);
  const result = compareClaim(claim.fields, comparable, bundle.ctx);
  const contentHash = contextFactHash(key, result, result.state);
  if (existing?.contentHash === contentHash) return result;

  const id = newId("ctx");
  tx.insert(contextFacts)
    .values({ id, caseId, key, claimLogicalKey: claim.row.logicalKey, valueJson: toJson(result), evidenceState: result.state, source: "comparison", sourceRef: bundle.caseRow.documentSetId, contentHash, createdAt: nowIso(), supersededBy: null })
    .run();
  if (existing) tx.update(contextFacts).set({ supersededBy: id }).where(eq(contextFacts.id, existing.id)).run();
  appendAudit(tx, {
    actorId: "system",
    type: "PUBLIC_EVIDENCE_COMPARED",
    entityType: "claim",
    entityId: claim.row.id,
    caseId,
    payload: { claim: claim.row.logicalKey, outcome: result.outcome, state: result.state, searched_documents: result.searchedDocuments, reasons: result.reasons, best_document: result.best?.documentId ?? null },
  });
  return result;
}

// ── Finding presentation (deterministic) ────────────────────────────────────

const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export function findingTitle(fields: ClaimFields): string {
  const subject = fields.subject_entity.name ?? (fields.subject_entity.kind === "industry" ? "Industry" : "Company not stated");
  const topic = fields.metric?.label ?? (fields.event_kind !== "none" ? `${fields.event_kind.replaceAll("_", " ")}${fields.scope_detail ? ` (${fields.scope_detail})` : ""}` : "statement");
  return `${subject} — ${topic}`;
}

interface MissingContextItem {
  ruleId: string;
  monitorId: string;
  predicate: string;
  state: string;
  question: string;
  explanation: string;
}

function summarize(policy: LoadedPolicy, runs: MonitorRun[], stepIndex: number) {
  const reviewRules: string[] = [];
  const contextRules: string[] = [];
  const conflicts: string[] = [];
  const missing: MissingContextItem[] = [];
  let escalation = false;
  let severity: Severity = "low";
  let ranked = 0;

  for (const run of runs) {
    const step = run.steps[stepIndex];
    const state = step.nextState;
    const rule = policy.rules.get(run.ruleId)?.rule;
    const isReview = state === "REVIEW_REQUIRED" || state === "ESCALATION_REQUESTED";
    if (isReview) reviewRules.push(run.ruleId);
    if (state === "NEEDS_CONTEXT") contextRules.push(run.ruleId);
    if (state === "ESCALATION_REQUESTED" || (isReview && rule?.on_true === "open_review_and_escalate")) escalation = true;
    const weight = isReview ? 10 : state === "NEEDS_CONTEXT" ? 1 : 0;
    if (rule && weight > 0 && weight + SEVERITY_RANK[rule.severity] > ranked) {
      ranked = weight + SEVERITY_RANK[rule.severity];
      severity = rule.severity;
    }
    for (const leaf of traceLeaves(step.guardTrace)) {
      if (leaf.state === "conflict") conflicts.push(`${run.ruleId}:${leaf.key}`);
      // Only the leaves that keep a rule from being decided are "missing context".
      if (state === "NEEDS_CONTEXT" && (leaf.state === "unknown" || leaf.state === "conflict")) {
        missing.push({
          ruleId: run.ruleId,
          monitorId: run.monitorId,
          predicate: leaf.key,
          state: leaf.state,
          question: getPredicate(leaf.name)?.clarifyQuestion ?? "What is missing here?",
          explanation: step.assessments[leaf.key]?.explanation ?? "",
        });
      }
    }
  }

  const parts: string[] = [];
  if (reviewRules.length > 0) parts.push(`Policy rule${reviewRules.length > 1 ? "s" : ""} ${reviewRules.join(", ")} ${reviewRules.length > 1 ? "are" : "is"} triggered.`);
  if (escalation) parts.push("The policy requires escalation to a senior compliance officer.");
  if (contextRules.length > 0) parts.push(`Rule${contextRules.length > 1 ? "s" : ""} ${contextRules.join(", ")} cannot be decided yet: context is missing.`);
  if (conflicts.length > 0) parts.push("The expert gave conflicting statements, which always opens review.");
  if (parts.length === 0) parts.push("No policy rule is triggered on the current evidence.");

  const reasonCodes = [...reviewRules.map((r) => `${r}:REVIEW_REQUIRED`), ...contextRules.map((r) => `${r}:NEEDS_CONTEXT`), ...conflicts.map((c) => `CONFLICT:${c}`)];
  return { reviewRules, contextRules, conflicts, missing, escalation, severity, explanation: parts.join(" "), reasonCodes };
}

// ── reevaluateCase ──────────────────────────────────────────────────────────

export interface ReevaluateOptions {
  actorId: string;
  /** Why this run happened, for the audit log: "analysis", "claim_corrected", "clarification", … */
  reason: string;
  eventType: "CLAIM_EVALUATED" | "CONTEXT_UPDATED";
  /**
   * Identifies the triggering event. Replaying with the same token is a no-op
   * for claims already evaluated under it (no duplicate tasks or findings).
   */
  eventToken: string;
  /** Limit evaluation to these claims; staleness and status still cover the whole case. */
  claimKeys?: string[];
  runId?: string | null;
}

export interface ReevaluateResult {
  policyVersionId: string | null;
  claimsEvaluated: number;
  findingsOpened: number;
  tasksOpened: number;
  stale: StaleOutcome[];
}

export function reevaluateCase(tx: DbOrTx, caseId: string, options: ReevaluateOptions): ReevaluateResult {
  let caseRow = getCase(tx, caseId);

  // 1. Pin the policy. A case with none yet adopts the active version.
  if (!caseRow.activePolicyVersionId) {
    const active = activePolicyVersion(tx);
    if (active) {
      tx.update(cases).set({ activePolicyVersionId: active.id, version: caseRow.version + 1 }).where(eq(cases.id, caseId)).run();
      caseRow = getCase(tx, caseId);
    }
  }
  const policy = caseRow.activePolicyVersionId ? loadPolicy(tx, caseRow.activePolicyVersionId) : null;
  const result: ReevaluateResult = { policyVersionId: policy?.version.id ?? null, claimsEvaluated: 0, findingsOpened: 0, tasksOpened: 0, stale: [] };

  const noPolicyIssue = tx.select().from(processingIssues).where(and(eq(processingIssues.caseId, caseId), eq(processingIssues.code, "NO_ACTIVE_POLICY"), eq(processingIssues.resolved, false))).get();
  if (!policy) {
    // Without an approved policy nothing can be evaluated; say so loudly rather than show "no findings".
    if (!noPolicyIssue) {
      tx.insert(processingIssues)
        .values({ id: newId("iss"), caseId, runId: options.runId ?? null, severity: "blocking", code: "NO_ACTIVE_POLICY", message: "No approved policy is active, so claims were not evaluated. Activate a policy version; the case is re-evaluated automatically.", refJson: "{}", resolved: false, createdAt: nowIso() })
        .run();
    }
    result.stale = runStalenessPass(tx, caseId, options.actorId);
    syncCaseStatus(tx, caseId, { actorId: options.actorId, cause: options.reason });
    return result;
  }
  if (noPolicyIssue) tx.update(processingIssues).set({ resolved: true }).where(eq(processingIssues.id, noPolicyIssue.id)).run();

  const bundle = loadCaseBundle(tx, caseId);
  const claims = loadCurrentClaims(tx, caseId).filter(isEvaluable).filter((c) => !options.claimKeys || options.claimKeys.includes(c.row.logicalKey));

  // 2–4. Assess, reduce, and turn effects into findings and tasks.
  for (const claim of claims) {
    const key = claim.row.logicalKey;
    const instances = tx.select().from(monitorInstances).where(and(eq(monitorInstances.caseId, caseId), eq(monitorInstances.claimLogicalKey, key), eq(monitorInstances.policyVersionId, policy.version.id))).all();
    const prefix = `${options.eventToken}:${key}`;
    if (instances.length > 0) {
      const replayed = tx.select({ id: monitorEvaluations.id }).from(monitorEvaluations).where(and(inArray(monitorEvaluations.instanceId, instances.map((i) => i.id)), like(monitorEvaluations.eventId, `${prefix}:%`))).limit(1).get();
      if (replayed) continue;
    }

    const match = loadPublicMatch(tx, caseId, { logicalKey: key, contentHash: claim.row.contentHash });
    const firstLook = instances.length === 0 && options.eventType === "CLAIM_EVALUATED";
    const evaluation = evaluateClaim({
      claim: claim.record,
      policy: { rules: policy.rules, monitors: policy.monitors },
      env: { caseContext: bundle.ctx, expert: bundle.expertProfile, publicMatch: match.fact },
      mode: firstLook ? "turn_ordered" : "full",
      eventType: options.eventType,
      eventIdPrefix: prefix,
      currentStates: Object.fromEntries(instances.map((i) => [i.monitorId, i.state])),
    });
    result.claimsEvaluated++;

    persistAssessments(tx, claim, evaluation, options.runId ?? null);
    const counts = persistMonitorRuns(tx, caseId, claim, policy, evaluation, instances, options);
    result.findingsOpened += counts.findingsOpened;
    result.tasksOpened += counts.tasksOpened;
  }

  // 5. Staleness, then 6. status.
  result.stale = runStalenessPass(tx, caseId, options.actorId);
  syncCaseStatus(tx, caseId, { actorId: options.actorId, cause: options.reason });
  appendAudit(tx, {
    actorId: options.actorId,
    type: "CASE_REEVALUATED",
    entityType: "case",
    entityId: caseId,
    caseId,
    payload: { reason: options.reason, event: options.eventType, policy_version: policy.version.id, claims: result.claimsEvaluated, findings_opened: result.findingsOpened, tasks_opened: result.tasksOpened, stale: result.stale.map((s) => s.label) },
  });
  return result;
}

function persistAssessments(tx: DbOrTx, claim: LoadedClaim, evaluation: ClaimEvaluation, runId: string | null): void {
  tx.delete(predicateAssessments).where(eq(predicateAssessments.claimId, claim.row.id)).run();
  for (const a of Object.values(evaluation.finalAssessments)) {
    tx.insert(predicateAssessments)
      .values({ id: newId("pa"), runId, claimId: claim.row.id, predicate: a.key, paramsJson: toJson(a.params), state: a.state, evidenceRefsJson: toJson(a.evidenceRefs), explanation: a.explanation })
      .run();
  }
}

type InstanceRow = typeof monitorInstances.$inferSelect;

function persistMonitorRuns(tx: DbOrTx, caseId: string, claim: LoadedClaim, policy: LoadedPolicy, evaluation: ClaimEvaluation, existing: InstanceRow[], options: ReevaluateOptions) {
  const key = claim.row.logicalKey;
  const counts = { findingsOpened: 0, tasksOpened: 0 };
  const instanceByMonitor = new Map(existing.map((i) => [i.monitorId, i]));
  const seqByInstance = new Map<string, number>();

  for (const run of evaluation.monitors) {
    let instance = instanceByMonitor.get(run.monitorId);
    if (!instance) {
      instance = { id: newId("mi"), caseId, claimLogicalKey: key, policyVersionId: policy.version.id, monitorId: run.monitorId, ruleId: run.ruleId, state: run.startState, version: 1 };
      tx.insert(monitorInstances).values(instance).run();
      instanceByMonitor.set(run.monitorId, instance);
    }
    const last = tx.select({ max: sql<number | null>`max(${monitorEvaluations.seq})` }).from(monitorEvaluations).where(eq(monitorEvaluations.instanceId, instance.id)).get();
    seqByInstance.set(instance.id, last?.max ?? 0);
  }

  const stepCount = evaluation.monitors[0]?.steps.length ?? 0;
  const dedupeKey = `policy:${caseId}:${key}`;
  let finding: FindingRow | null = tx.select().from(findings).where(eq(findings.dedupeKey, dedupeKey)).get() ?? null;

  for (let i = 0; i < stepCount; i++) {
    const turnLabel = evaluation.monitors[0].steps[i].turnLabel;
    const at = turnLabel ? ` at ${turnLabel}` : "";

    // Record every monitor's step first, so the finding reflects all rules at this point in the call.
    for (const run of evaluation.monitors) {
      const instance = instanceByMonitor.get(run.monitorId)!;
      const step = run.steps[i];
      const seq = seqByInstance.get(instance.id)! + 1;
      seqByInstance.set(instance.id, seq);
      tx.insert(monitorEvaluations)
        .values({
          id: newId("me"),
          instanceId: instance.id,
          seq,
          eventType: step.eventType,
          eventId: step.eventId,
          prevState: step.prevState,
          nextState: step.nextState,
          transitionId: step.transitionId,
          result: step.result,
          turnLabel: step.turnLabel,
          conflictFlag: step.conflictFlag,
          guardTraceJson: toJson({ trace: step.guardTrace, assessments: step.assessments }),
          effectsJson: toJson(step.effects),
          createdAt: nowIso(),
        })
        .run();
      if (step.nextState !== instance.state) {
        instance.state = step.nextState;
        instance.version += 1;
        tx.update(monitorInstances).set({ state: instance.state, version: instance.version }).where(eq(monitorInstances.id, instance.id)).run();
      }
    }

    const summary = summarize(policy, evaluation.monitors, i);
    const anyConflict = evaluation.monitors.some((run) => run.steps[i].conflictFlag);
    let aggregate: MonitorAggregate = aggregateMonitorStates(evaluation.monitors.map((run) => run.steps[i].nextState));
    // A conflict on any guard predicate always opens review, even when the guard is false (§7.1).
    if (anyConflict) aggregate = "REVIEW_REQUIRED";

    if (!finding) {
      const initial = initialFindingState(aggregate);
      if (!initial) continue; // nothing triggered and nothing missing: no finding
      const lead = evaluation.monitors.find((run) => summary.reviewRules.includes(run.ruleId) || summary.contextRules.includes(run.ruleId));
      const created = createFinding(tx, {
        caseId,
        claimLogicalKey: key,
        origin: "policy",
        monitorInstanceId: lead ? instanceByMonitor.get(lead.monitorId)!.id : null,
        title: findingTitle(claim.fields),
        severity: summary.severity,
        state: initial,
        reasonCodes: summary.reasonCodes,
        explanation: summary.explanation,
        missingContext: summary.missing,
        dedupeKey,
        createdBy: "system",
        auditPayload: { at_turn: turnLabel, rules: [...summary.reviewRules, ...summary.contextRules] },
      });
      finding = created.finding;
      if (created.created) counts.findingsOpened++;
    } else {
      const event = monitorEventFor(aggregate);
      if (event) {
        finding = applyFindingEvent(tx, finding, event, SYSTEM_GUARD, { actorId: "system", cause: `policy monitors${at}`, extra: { at_turn: turnLabel, rules: summary.reasonCodes } }).finding;
      }
      // A decided finding keeps the description it was decided on; staleness reopens it if the evidence moved.
      if (finding.state !== "DISPOSITIONED") {
        updateFindingSummary(tx, finding, { title: findingTitle(claim.fields), severity: summary.severity, reasonCodes: summary.reasonCodes, explanation: summary.explanation, missingContext: summary.missing });
      }
    }

    counts.tasksOpened += applyEffects(tx, caseId, claim, policy, finding, evaluation.monitors, i, instanceByMonitor, options.actorId);
  }
  return counts;
}

/** Translates one step's proposed effects into tasks. The workflow, not the monitor, decides what they mean. */
function applyEffects(tx: DbOrTx, caseId: string, claim: LoadedClaim, policy: LoadedPolicy, finding: FindingRow, runs: MonitorRun[], stepIndex: number, instances: Map<string, InstanceRow>, actorId: string): number {
  let opened = 0;
  const decided = finding.state === "DISPOSITIONED";
  const label = findingLabel(finding);

  for (const run of runs) {
    const step = run.steps[stepIndex];
    const instance = instances.get(run.monitorId)!;
    const at = step.turnLabel ? ` at ${step.turnLabel}` : "";
    const base = `${instance.id}:${step.transitionId ?? "none"}:${step.eventId}`;

    for (const effect of step.effects) {
      if (effect === "CLOSE_CONTEXT_TASK") {
        for (const task of openTasksOf(tx, finding.id, "context").filter((t) => t.monitorInstanceId === instance.id)) {
          closeTask(tx, task, { status: "done", actorId: "system", reason: `rule ${run.ruleId} no longer needs context${at}` });
        }
      }
      if (decided) continue; // never reopen work on a decided finding from a monitor alone
      if (effect === "OPEN_CONTEXT_TASK") {
        if (openTasksOf(tx, finding.id, "context").some((t) => t.monitorInstanceId === instance.id)) continue;
        const question = contextQuestion(step);
        const r = openTask(tx, {
          caseId,
          findingId: finding.id,
          monitorInstanceId: instance.id,
          kind: "context",
          question: question.text,
          assignedRole: "reviewer",
          dedupeKey: `${base}:context`,
          meta: { ruleId: run.ruleId, unknown: question.unknown, aiSuggestedQuestions: claim.meta.aiQuestions, atTurn: step.turnLabel },
          actorId,
        });
        if (r.created) opened++;
      }
      if (effect === "OPEN_REVIEW_TASK") {
        if (openTasksOf(tx, finding.id, "review").length > 0) continue;
        const r = openTask(tx, { caseId, findingId: finding.id, monitorInstanceId: instance.id, kind: "review", question: `Review ${label}: rule ${run.ruleId} is triggered${at}.`, assignedRole: "reviewer", dedupeKey: `${base}:review`, meta: { ruleId: run.ruleId, atTurn: step.turnLabel }, actorId });
        if (r.created) opened++;
      }
      if (effect === "REQUEST_ESCALATION") {
        if (openTasksOf(tx, finding.id, "escalation").length > 0) continue;
        const intent = policy.rules.get(run.ruleId)?.rule.intent ?? "";
        const r = openTask(tx, {
          caseId,
          findingId: finding.id,
          monitorInstanceId: instance.id,
          kind: "escalation",
          question: `Rule ${run.ruleId} requires a senior compliance officer to decide ${label}${intent ? ` (${intent})` : ""}.`,
          assignedRole: "senior_reviewer",
          dedupeKey: `${base}:escalation`,
          meta: { ruleId: run.ruleId, atTurn: step.turnLabel, requestedBy: "policy" },
          actorId,
        });
        if (r.created) opened++;
      }
    }

    if (step.conflictFlag && !decided && openTasksOf(tx, finding.id, "review").length === 0) {
      const conflicting = traceLeaves(step.guardTrace).filter((l) => l.state === "conflict").map((l) => l.key);
      const r = openTask(tx, { caseId, findingId: finding.id, monitorInstanceId: instance.id, kind: "review", question: `Review ${label}: the expert gave conflicting statements (${conflicting.join(", ")}).`, assignedRole: "reviewer", dedupeKey: `${base}:conflict`, meta: { ruleId: run.ruleId, conflict: conflicting }, actorId });
      if (r.created) opened++;
    }
  }
  return opened;
}

function contextQuestion(step: MonitorStep): { text: string; unknown: string[] } {
  const leaves = traceLeaves(step.guardTrace).filter((l) => l.state === "unknown" || l.state === "conflict");
  const questions = [...new Set(leaves.map((l) => getPredicate(l.name)?.clarifyQuestion).filter((q): q is string => Boolean(q)))];
  return { text: questions.join(" ") || "What context is missing for this statement?", unknown: leaves.map((l) => l.key) };
}
