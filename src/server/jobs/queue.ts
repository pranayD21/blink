/**
 * The jobs table is the queue (decision D3): a separate worker process polls
 * it, so background work survives page reloads, shows stage progress, and
 * retries — with no Redis.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, getDb, toJson, transact } from "../db/client";
import { jobs } from "../db/schema";
import { newId } from "../ids";

export type JobType = (typeof jobs.$inferSelect)["type"];
export type JobRow = typeof jobs.$inferSelect;

export interface JobView {
  id: string;
  type: JobType;
  status: JobRow["status"];
  stage: string;
  progress: number;
  attempts: number;
  error: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const MAX_JOB_ATTEMPTS = 2;

export function toJobView(row: JobRow): JobView {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    attempts: row.attempts,
    error: row.error,
    payload: fromJson<Record<string, unknown>>(row.payloadJson, {}),
    result: fromJson<Record<string, unknown> | null>(row.resultJson, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Enqueues a job. With an idempotency key, a repeat returns the existing job instead of adding one. */
export function enqueueJob(tx: DbOrTx, type: JobType, payload: Record<string, unknown>, options: { idempotencyKey?: string } = {}): JobRow {
  if (options.idempotencyKey) {
    const existing = tx.select().from(jobs).where(eq(jobs.idempotencyKey, options.idempotencyKey)).get();
    if (existing) return existing;
  }
  const now = nowIso();
  const row: JobRow = {
    id: newId("job"),
    type,
    payloadJson: toJson(payload),
    status: "queued",
    stage: "Queued",
    progress: 0,
    attempts: 0,
    error: null,
    resultJson: null,
    idempotencyKey: options.idempotencyKey ?? null,
    createdAt: now,
    updatedAt: now,
  };
  tx.insert(jobs).values(row).run();
  return row;
}

export function getJob(db: DbOrTx, id: string): JobRow | undefined {
  return db.select().from(jobs).where(eq(jobs.id, id)).get();
}

/** Atomically takes the oldest queued job, or returns null. */
export function claimNextJob(): JobRow | null {
  return transact((tx) => {
    const next = tx.select().from(jobs).where(eq(jobs.status, "queued")).orderBy(asc(jobs.createdAt), asc(jobs.id)).limit(1).get();
    if (!next) return null;
    const now = nowIso();
    tx.update(jobs).set({ status: "running", attempts: next.attempts + 1, stage: "Starting", error: null, updatedAt: now }).where(and(eq(jobs.id, next.id), eq(jobs.status, "queued"))).run();
    return { ...next, status: "running" as const, attempts: next.attempts + 1, stage: "Starting", updatedAt: now };
  });
}

export function setJobStage(id: string, stage: string, progress: number): void {
  getDb().update(jobs).set({ stage, progress: Math.max(0, Math.min(100, Math.round(progress))), updatedAt: nowIso() }).where(eq(jobs.id, id)).run();
}

export function completeJob(id: string, result: Record<string, unknown>): void {
  getDb().update(jobs).set({ status: "succeeded", stage: "Done", progress: 100, resultJson: toJson(result), error: null, updatedAt: nowIso() }).where(eq(jobs.id, id)).run();
}

/** Fails a job. A retryable failure goes back on the queue until attempts run out. */
export function failJob(id: string, error: string, options: { retry: boolean }): "requeued" | "failed" {
  const row = getJob(getDb(), id);
  const requeue = options.retry && row !== undefined && row.attempts < MAX_JOB_ATTEMPTS;
  getDb()
    .update(jobs)
    .set({ status: requeue ? "queued" : "failed", stage: requeue ? "Retrying" : "Failed", error, updatedAt: nowIso() })
    .where(eq(jobs.id, id))
    .run();
  return requeue ? "requeued" : "failed";
}

/** A worker that died mid-job leaves it `running` forever; a starting worker puts such jobs back. */
export function requeueOrphanedJobs(): number {
  const result = getDb().update(jobs).set({ status: "queued", stage: "Requeued after worker restart", updatedAt: nowIso() }).where(eq(jobs.status, "running")).run();
  return result.changes;
}

export function countQueued(db: DbOrTx): number {
  return db.select({ n: sql<number>`count(*)` }).from(jobs).where(eq(jobs.status, "queued")).get()?.n ?? 0;
}
