/**
 * Review-session timing (§16 Phase 7, §18.3): starts when a reviewer opens a
 * case or its baseline page, pauses after 2 minutes idle, ends on attest or
 * release (or on the baseline decision).
 *
 * The client sends a heartbeat while the reviewer is active. Time between two
 * heartbeats counts only if the gap is under the idle threshold.
 */
import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../auth/actor";
import { nowIso } from "../clock";
import { type DbOrTx, toJson } from "../db/client";
import { reviewSessions } from "../db/schema";
import { newId } from "../ids";

export const IDLE_THRESHOLD_MS = 2 * 60 * 1000;
export type SessionMode = "blink" | "baseline";

function openSession(tx: DbOrTx, caseId: string, actorId: string, mode: SessionMode) {
  return tx.select().from(reviewSessions).where(and(eq(reviewSessions.caseId, caseId), eq(reviewSessions.actorId, actorId), eq(reviewSessions.mode, mode), isNull(reviewSessions.endedAt))).get() ?? null;
}

export function heartbeat(tx: DbOrTx, caseId: string, actor: Actor, mode: SessionMode): { sessionId: string; activeMs: number } {
  const now = nowIso();
  const session = openSession(tx, caseId, actor.id, mode);
  if (!session) {
    const id = newId("ses");
    tx.insert(reviewSessions).values({ id, caseId, actorId: actor.id, mode, startedAt: now, endedAt: null, activeMs: 0, lastActivityAt: now, outcomeJson: null }).run();
    return { sessionId: id, activeMs: 0 };
  }
  const gap = Date.parse(now) - Date.parse(session.lastActivityAt);
  // A gap longer than the idle threshold is a pause: the reviewer was away.
  const activeMs = session.activeMs + (gap > 0 && gap <= IDLE_THRESHOLD_MS ? gap : 0);
  tx.update(reviewSessions).set({ activeMs, lastActivityAt: now }).where(eq(reviewSessions.id, session.id)).run();
  return { sessionId: session.id, activeMs };
}

export function endSession(tx: DbOrTx, caseId: string, actorId: string, mode: SessionMode, outcome?: unknown): void {
  const session = openSession(tx, caseId, actorId, mode);
  if (!session) return;
  const now = nowIso();
  const gap = Date.parse(now) - Date.parse(session.lastActivityAt);
  const activeMs = session.activeMs + (gap > 0 && gap <= IDLE_THRESHOLD_MS ? gap : 0);
  tx.update(reviewSessions).set({ activeMs, lastActivityAt: now, endedAt: now, outcomeJson: outcome === undefined ? session.outcomeJson : toJson(outcome) }).where(eq(reviewSessions.id, session.id)).run();
}
