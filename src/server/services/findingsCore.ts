/**
 * Low-level finding and task writes shared by evaluation, staleness, and the
 * reviewer-facing finding service. Every state change goes through the pure
 * workflow in `core/workflow/finding.ts` and is audited.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { type FindingEvent, type FindingGuardContext, type FindingState, transitionFinding } from "@/core/workflow/finding";
import type { Severity } from "@/core/types";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, toJson } from "../db/client";
import { decisions, findings, processingIssues, tasks } from "../db/schema";
import { newId } from "../ids";

export type FindingRow = typeof findings.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type DecisionRow = typeof decisions.$inferSelect;

export const SYSTEM_GUARD: FindingGuardContext = { actorRole: "system", escalationRequired: false, hasOpenBlockingIssue: false };

export const findingLabel = (f: Pick<FindingRow, "seqNo">) => `F${f.seqNo}`;

export function nextFindingSeq(tx: DbOrTx, caseId: string): number {
  const row = tx.select({ max: sql<number | null>`max(${findings.seqNo})` }).from(findings).where(eq(findings.caseId, caseId)).get();
  return (row?.max ?? 0) + 1;
}

export interface NewFinding {
  caseId: string;
  claimLogicalKey: string | null;
  origin: FindingRow["origin"];
  monitorInstanceId?: string | null;
  title: string;
  severity: Severity;
  state: FindingState;
  reasonCodes?: string[];
  explanation?: string;
  missingContext?: unknown[];
  dedupeKey: string;
  createdBy: string;
  auditPayload?: Record<string, unknown>;
}

/** Creates a finding, or returns the existing one with the same dedupe key (replay safety, §9.1 step 4). */
export function createFinding(tx: DbOrTx, input: NewFinding): { finding: FindingRow; created: boolean } {
  const existing = tx.select().from(findings).where(eq(findings.dedupeKey, input.dedupeKey)).get();
  if (existing) return { finding: existing, created: false };
  const row: FindingRow = {
    id: newId("fnd"),
    caseId: input.caseId,
    claimLogicalKey: input.claimLogicalKey,
    origin: input.origin,
    monitorInstanceId: input.monitorInstanceId ?? null,
    title: input.title,
    severity: input.severity,
    state: input.state,
    reasonCodesJson: toJson(input.reasonCodes ?? []),
    explanation: input.explanation ?? "",
    missingContextJson: toJson(input.missingContext ?? []),
    dedupeKey: input.dedupeKey,
    seqNo: nextFindingSeq(tx, input.caseId),
    createdBy: input.createdBy,
    createdAt: nowIso(),
    version: 1,
  };
  tx.insert(findings).values(row).run();
  appendAudit(tx, {
    actorId: input.createdBy,
    type: "FINDING_OPENED",
    entityType: "finding",
    entityId: row.id,
    caseId: input.caseId,
    payload: { label: findingLabel(row), origin: row.origin, state: row.state, severity: row.severity, claim: row.claimLogicalKey, title: row.title, ...input.auditPayload },
  });
  return { finding: row, created: true };
}

/**
 * Applies a workflow event. Returns the updated row, or the unchanged row
 * when the event is a no-op in the current state. Throws nothing: callers
 * that act for a person check `result.ok` and map the error to HTTP.
 */
export function applyFindingEvent(
  tx: DbOrTx,
  finding: FindingRow,
  event: FindingEvent,
  guard: FindingGuardContext,
  audit: { actorId: string; cause: string; extra?: Record<string, unknown> },
): { result: ReturnType<typeof transitionFinding>; finding: FindingRow } {
  const result = transitionFinding(finding.state as FindingState, event, guard);
  if (!result.ok || !result.changed) return { result, finding };
  const next: FindingRow = { ...finding, state: result.next, version: finding.version + 1 };
  tx.update(findings).set({ state: next.state, version: next.version }).where(eq(findings.id, finding.id)).run();
  appendAudit(tx, {
    actorId: audit.actorId,
    type: "FINDING_STATE_CHANGED",
    entityType: "finding",
    entityId: finding.id,
    caseId: finding.caseId,
    payload: { label: findingLabel(finding), from: finding.state, to: next.state, event: event.type, cause: audit.cause, ...audit.extra },
  });
  return { result, finding: next };
}

export function updateFindingSummary(
  tx: DbOrTx,
  finding: FindingRow,
  patch: { title?: string; severity?: Severity; reasonCodes?: string[]; explanation?: string; missingContext?: unknown[]; monitorInstanceId?: string | null },
): void {
  tx.update(findings)
    .set({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.reasonCodes !== undefined ? { reasonCodesJson: toJson(patch.reasonCodes) } : {}),
      ...(patch.explanation !== undefined ? { explanation: patch.explanation } : {}),
      ...(patch.missingContext !== undefined ? { missingContextJson: toJson(patch.missingContext) } : {}),
      ...(patch.monitorInstanceId !== undefined ? { monitorInstanceId: patch.monitorInstanceId } : {}),
    })
    .where(eq(findings.id, finding.id))
    .run();
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export interface NewTask {
  caseId: string;
  findingId: string;
  monitorInstanceId?: string | null;
  kind: TaskRow["kind"];
  question: string;
  assignedRole: string;
  dedupeKey: string;
  meta?: Record<string, unknown>;
  actorId: string;
}

/** Opens a task unless one with the same dedupe key already exists. */
export function openTask(tx: DbOrTx, input: NewTask): { task: TaskRow; created: boolean } {
  const existing = tx.select().from(tasks).where(eq(tasks.dedupeKey, input.dedupeKey)).get();
  if (existing) return { task: existing, created: false };
  const row: TaskRow = {
    id: newId("tsk"),
    caseId: input.caseId,
    findingId: input.findingId,
    monitorInstanceId: input.monitorInstanceId ?? null,
    kind: input.kind,
    status: "open",
    question: input.question,
    answer: null,
    assignedRole: input.assignedRole,
    dedupeKey: input.dedupeKey,
    metaJson: toJson(input.meta ?? {}),
    createdAt: nowIso(),
    closedAt: null,
    closedBy: null,
    version: 1,
  };
  tx.insert(tasks).values(row).run();
  appendAudit(tx, {
    actorId: input.actorId,
    type: "TASK_OPENED",
    entityType: "task",
    entityId: row.id,
    caseId: input.caseId,
    payload: { kind: row.kind, findingId: row.findingId, assignedRole: row.assignedRole, question: row.question, ...input.meta },
  });
  return { task: row, created: true };
}

export function openTasksOf(tx: DbOrTx, findingId: string, kind?: TaskRow["kind"]): TaskRow[] {
  const rows = tx.select().from(tasks).where(and(eq(tasks.findingId, findingId), eq(tasks.status, "open"))).all();
  return kind ? rows.filter((t) => t.kind === kind) : rows;
}

export function closeTask(tx: DbOrTx, task: TaskRow, input: { status: "done" | "cancelled"; actorId: string; answer?: string | null; reason: string }): TaskRow {
  if (task.status !== "open") return task;
  const next: TaskRow = { ...task, status: input.status, answer: input.answer ?? task.answer, closedAt: nowIso(), closedBy: input.actorId, version: task.version + 1 };
  tx.update(tasks).set({ status: next.status, answer: next.answer, closedAt: next.closedAt, closedBy: next.closedBy, version: next.version }).where(eq(tasks.id, task.id)).run();
  appendAudit(tx, {
    actorId: input.actorId,
    type: input.status === "done" ? "TASK_DONE" : "TASK_CANCELLED",
    entityType: "task",
    entityId: task.id,
    caseId: task.caseId,
    payload: { kind: task.kind, findingId: task.findingId, reason: input.reason, ...(input.answer ? { answer: input.answer } : {}) },
  });
  return next;
}

/** An open escalation task is what reserves a finding's decision for a senior reviewer. */
export function escalationRequired(tx: DbOrTx, findingId: string): boolean {
  return openTasksOf(tx, findingId, "escalation").length > 0;
}

// ── Decisions ───────────────────────────────────────────────────────────────

/** The newest disposition (or escalation decision) on a finding; escalation requests are not decisions on the merits. */
export function latestDecision(tx: DbOrTx, findingId: string): DecisionRow | null {
  return (
    tx
      .select()
      .from(decisions)
      .where(eq(decisions.findingId, findingId))
      .orderBy(desc(decisions.createdAt), desc(decisions.id))
      .all()
      .find((d) => d.kind !== "escalation_request") ?? null
  );
}

export function openBlockingIssues(tx: DbOrTx, caseId: string): (typeof processingIssues.$inferSelect)[] {
  return tx.select().from(processingIssues).where(and(eq(processingIssues.caseId, caseId), eq(processingIssues.severity, "blocking"), eq(processingIssues.resolved, false))).all();
}
