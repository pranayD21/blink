/**
 * Reviewer actions on findings and tasks (§9.2, §10.6).
 *
 * People decide; this service checks who they are, runs the fixed workflow,
 * and records what each decision was based on.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { contextFactHash, evidenceHash } from "@/core/deps/hash";
import { VerifiedFieldsSchema } from "@/core/extraction/schema";
import { ALL_OUTCOMES } from "@/core/workflow/finding";
import type { DispositionOutcome } from "@/core/types";
import { type Actor, requireReviewer } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, toJson } from "../db/client";
import { contextFacts, decisions, findings, tasks } from "../db/schema";
import { forbidden, notFound, unprocessable, versionConflict } from "../errors";
import { newId } from "../ids";
import { syncCaseStatus } from "./caseStatus";
import { applyCorrection } from "./claims";
import { reevaluateCase } from "./evaluation";
import { type FindingRow, applyFindingEvent, closeTask, createFinding, escalationRequired, findingLabel, openBlockingIssues, openTask, openTasksOf } from "./findingsCore";
import { currentClaimByKey, getCase, hydrateClaims, loadPolicy } from "./loaders";
import { edgesForFinding, recordDependencies } from "./staleness";

const Version = z.number().int();

export const FindingEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("PROMOTE"), rationale: z.string(), expectedVersion: Version }),
  z.strictObject({ type: z.literal("ESCALATE"), rationale: z.string(), expectedVersion: Version }),
  z.strictObject({ type: z.literal("DISPOSE"), outcome: z.enum(ALL_OUTCOMES as [DispositionOutcome, ...DispositionOutcome[]]), rationale: z.string(), expectedVersion: Version }),
]);
export type FindingEventInput = z.infer<typeof FindingEventSchema>;

export function getFinding(tx: DbOrTx, findingId: string): FindingRow {
  const row = tx.select().from(findings).where(eq(findings.id, findingId)).get();
  if (!row) throw notFound("finding");
  return row;
}

/** POST /api/findings/:id/events */
export function applyFindingAction(tx: DbOrTx, findingId: string, input: FindingEventInput, actor: Actor): { finding: FindingRow; decisionId: string | null } {
  requireReviewer(actor); // analysts may not even learn whether a finding exists
  const finding = getFinding(tx, findingId);
  if (finding.version !== input.expectedVersion) throw versionConflict(`finding ${findingLabel(finding)}`, input.expectedVersion, finding.version);

  const caseRow = getCase(tx, finding.caseId);
  const mustEscalate = escalationRequired(tx, finding.id);
  const blockedByIssue = openBlockingIssues(tx, finding.caseId).some((i) => finding.claimLogicalKey !== null && fromJson<{ claim?: string }>(i.refJson, {}).claim === finding.claimLogicalKey);
  const event = input.type === "DISPOSE" ? { type: "DISPOSE" as const, outcome: input.outcome, rationale: input.rationale } : { type: input.type, rationale: input.rationale };
  const label = findingLabel(finding);

  const { result, finding: updated } = applyFindingEvent(tx, finding, event, { actorRole: actor.role, escalationRequired: mustEscalate, hasOpenBlockingIssue: blockedByIssue }, { actorId: actor.id, cause: input.type.toLowerCase(), extra: { rationale: input.rationale.trim() } });
  if (!result.ok) {
    if (result.error === "FORBIDDEN_ROLE") throw forbidden(result.message);
    throw unprocessable(result.message, result.error);
  }

  let decisionId: string | null = null;
  const rationale = input.rationale.trim();

  if (input.type === "PROMOTE") {
    if (openTasksOf(tx, finding.id, "review").length === 0) {
      openTask(tx, { caseId: finding.caseId, findingId: finding.id, kind: "review", question: `Review ${label}: promoted by a reviewer (${rationale}).`, assignedRole: "reviewer", dedupeKey: `promote:${finding.id}:${finding.version}`, meta: { promotedBy: actor.id }, actorId: actor.id });
    }
    for (const task of openTasksOf(tx, finding.id).filter((t) => t.kind === "context" || t.kind === "clarification")) {
      closeTask(tx, task, { status: "cancelled", actorId: actor.id, reason: "finding promoted to review without this context" });
    }
  }

  if (input.type === "ESCALATE") {
    decisionId = newId("dec");
    const policy = caseRow.activePolicyVersionId ? loadPolicy(tx, caseRow.activePolicyVersionId) : null;
    const edges = edgesForFinding(tx, caseRow, finding, policy);
    // An escalation request is a hand-off, not a decision on the merits: its evidence is recorded for the audit trail only.
    tx.insert(decisions).values({ id: decisionId, caseId: finding.caseId, findingId: finding.id, actorId: actor.id, kind: "escalation_request", outcome: null, rationale, evidenceHash: evidenceHash(edges), stale: false, staleReason: null, createdAt: nowIso() }).run();
    if (!mustEscalate) {
      openTask(tx, { caseId: finding.caseId, findingId: finding.id, kind: "escalation", question: `A reviewer escalated ${label}: ${rationale}`, assignedRole: "senior_reviewer", dedupeKey: `escalate:${decisionId}`, meta: { requestedBy: actor.id }, actorId: actor.id });
    }
    appendAudit(tx, { actorId: actor.id, type: "FINDING_ESCALATED", entityType: "finding", entityId: finding.id, caseId: finding.caseId, payload: { label, rationale, decision: decisionId } });
  }

  if (input.type === "DISPOSE" && result.decisionKind) {
    decisionId = newId("dec");
    const policy = caseRow.activePolicyVersionId ? loadPolicy(tx, caseRow.activePolicyVersionId) : null;
    const edges = edgesForFinding(tx, caseRow, finding, policy);
    const evidence = recordDependencies(tx, finding.caseId, "decision", decisionId, edges);
    tx.insert(decisions).values({ id: decisionId, caseId: finding.caseId, findingId: finding.id, actorId: actor.id, kind: result.decisionKind, outcome: input.outcome, rationale, evidenceHash: evidence, stale: false, staleReason: null, createdAt: nowIso() }).run();
    for (const task of openTasksOf(tx, finding.id)) {
      const answered = task.kind === "review" || task.kind === "escalation";
      closeTask(tx, task, { status: answered ? "done" : "cancelled", actorId: actor.id, reason: `finding dispositioned ${input.outcome}` });
    }
    appendAudit(tx, {
      actorId: actor.id,
      type: "FINDING_DISPOSITIONED",
      entityType: "finding",
      entityId: finding.id,
      caseId: finding.caseId,
      payload: { label, outcome: input.outcome, kind: result.decisionKind, rationale, decided_by_role: actor.role, decision: decisionId, evidence_hash: evidence, evidence: edges.map((e) => ({ source: e.sourceType, label: e.sourceLabel, hash: e.sourceHash })) },
    });
  }

  syncCaseStatus(tx, finding.caseId, { actorId: actor.id, cause: `finding ${label} ${input.type.toLowerCase()}` });
  return { finding: getFinding(tx, updated.id), decisionId };
}

export const CreateFindingSchema = z.strictObject({
  caseId: z.string(),
  title: z.string().trim().min(3),
  severity: z.enum(["high", "medium", "low"]),
  explanation: z.string().trim().min(1, "say why you are raising this"),
  claimLogicalKey: z.string().nullable().default(null),
  turnLabel: z.string().regex(/^T\d+$/).nullable().default(null),
});
export type CreateFindingInput = z.infer<typeof CreateFindingSchema>;

/** POST /api/findings — a reviewer raises a concern the policy and the model did not. */
export function createReviewerFinding(tx: DbOrTx, input: CreateFindingInput, actor: Actor): FindingRow {
  requireReviewer(actor);
  const caseRow = getCase(tx, input.caseId);
  if (caseRow.status === "INTAKE" || caseRow.status === "ANALYZING") throw unprocessable("the case has not been analyzed yet");
  if (input.claimLogicalKey && !currentClaimByKey(tx, input.caseId, input.claimLogicalKey)) throw notFound(`claim ${input.claimLogicalKey}`);
  const { finding } = createFinding(tx, {
    caseId: input.caseId,
    claimLogicalKey: input.claimLogicalKey,
    origin: "reviewer",
    title: input.title,
    severity: input.severity,
    state: "REVIEW_REQUIRED",
    reasonCodes: ["REVIEWER_CREATED", ...(input.turnLabel ? [`TURN:${input.turnLabel}`] : [])],
    explanation: input.explanation,
    dedupeKey: `reviewer:${newId("f")}`,
    createdBy: actor.id,
    auditPayload: { turn: input.turnLabel },
  });
  openTask(tx, { caseId: input.caseId, findingId: finding.id, kind: "review", question: `Review ${findingLabel(finding)}: raised by ${actor.name}.`, assignedRole: "reviewer", dedupeKey: `reviewer-review:${finding.id}`, meta: { createdBy: actor.id }, actorId: actor.id });
  syncCaseStatus(tx, input.caseId, { actorId: actor.id, cause: `reviewer finding ${findingLabel(finding)} created` });
  return finding;
}

export const AddClarificationSchema = z.strictObject({ question: z.string().trim().min(5, "write the question to ask") });

/** A reviewer writes their own clarification question for a finding (§10.6). */
export function addClarificationTask(tx: DbOrTx, findingId: string, question: string, actor: Actor) {
  requireReviewer(actor);
  const finding = getFinding(tx, findingId);
  if (finding.state === "DISPOSITIONED") throw unprocessable("this finding is already decided");
  return openTask(tx, { caseId: finding.caseId, findingId, kind: "clarification", question, assignedRole: "reviewer", dedupeKey: `clarify:${newId("q")}`, meta: { writtenBy: actor.id }, actorId: actor.id }).task;
}

export const AnswerTaskSchema = z.strictObject({
  answer: z.string().trim().min(3, "record the answer you received"),
  /** Maps the answer onto claim fields, e.g. { knowledge_basis: "public_source" }. These become verified overrides. */
  fieldMapping: VerifiedFieldsSchema.default({}),
  expectedVersion: Version,
});
export type AnswerTaskInput = z.infer<typeof AnswerTaskSchema>;

/**
 * POST /api/tasks/:id/answer — records a clarification, maps it onto claim
 * fields, and re-runs the monitors with a CONTEXT_UPDATED event. The monitors'
 * resulting state decides where the finding goes; the reviewer does not.
 */
export function answerTask(tx: DbOrTx, taskId: string, input: AnswerTaskInput, actor: Actor): { findingId: string; contextFactId: string; claimVersion: number | null } {
  requireReviewer(actor);
  const task = tx.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) throw notFound("task");
  if (task.version !== input.expectedVersion) throw versionConflict("this task", input.expectedVersion, task.version);
  if (task.kind !== "context" && task.kind !== "clarification") throw unprocessable(`a ${task.kind} task is not answered with a clarification`);
  if (task.status !== "open") throw unprocessable("this task is already closed");
  const finding = getFinding(tx, task.findingId);

  const factId = newId("ctx");
  const key = `clarification:${task.id}`;
  const value = { question: task.question, answer: input.answer, answeredBy: actor.id, fieldMapping: input.fieldMapping };
  tx.insert(contextFacts)
    .values({ id: factId, caseId: task.caseId, key, claimLogicalKey: finding.claimLogicalKey, valueJson: toJson(value), evidenceState: "supported", source: "clarification", sourceRef: task.id, contentHash: contextFactHash(key, value, "supported"), createdAt: nowIso(), supersededBy: null })
    .run();
  closeTask(tx, task, { status: "done", actorId: actor.id, answer: input.answer, reason: "clarification answered" });
  appendAudit(tx, { actorId: actor.id, type: "CLARIFICATION_ANSWERED", entityType: "task", entityId: task.id, caseId: task.caseId, payload: { finding: findingLabel(finding), question: task.question, answer: input.answer, field_mapping: input.fieldMapping, context_fact: factId } });

  let claimVersion: number | null = null;
  const claimRow = finding.claimLogicalKey ? currentClaimByKey(tx, task.caseId, finding.claimLogicalKey) : null;
  if (claimRow && Object.keys(input.fieldMapping).length > 0) {
    claimVersion = applyCorrection(tx, hydrateClaims(tx, [claimRow])[0], { verified: input.fieldMapping, note: `clarification: ${input.answer}` }, actor, { source: "clarification", taskId: task.id }).versionNo;
  }
  reevaluateCase(tx, task.caseId, { actorId: actor.id, reason: "clarification answered", eventType: "CONTEXT_UPDATED", eventToken: `ctx:${factId}`, claimKeys: finding.claimLogicalKey ? [finding.claimLogicalKey] : [] });
  return { findingId: finding.id, contextFactId: factId, claimVersion };
}
