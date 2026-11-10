/**
 * Review-session timing (§16 Phase 7, §18.3): starts when a reviewer opens a
 * case or its baseline page, pauses after 2 minutes idle, ends on attest or
 * release (or on the baseline decision).
 *
 * The client sends a heartbeat while the reviewer is active. Time between two
 * heartbeats counts only if the gap is under the idle threshold.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { type Actor, requireReviewer } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, toJson } from "../db/client";
import { analysisRuns, reviewSessions } from "../db/schema";
import { unprocessable } from "../errors";
import { newId } from "../ids";
import { currentTranscript, getCase, turnsOfVersion } from "./loaders";

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

// ── Baseline mode (§15.1, §18.3) ────────────────────────────────────────────

export const BaselineDecisionSchema = z.strictObject({
  outcome: z.enum(["no_concern", "needs_follow_up", "restricted"]),
  /** Turn labels the reviewer would flag, as they found them unaided. */
  flaggedTurns: z.array(z.string().regex(/^T\d+$/)).default([]),
  notes: z.string().trim().min(10, "say briefly what you decided and why"),
});
export type BaselineDecision = z.infer<typeof BaselineDecisionSchema>;

/**
 * What a reviewer gets without Blink: the transcript and a plain AI summary.
 * No claims, findings, traces, or public-evidence comparison — the point is to
 * time the same review without them.
 */
export function baselineView(db: DbOrTx, caseId: string, actor: Actor) {
  requireReviewer(actor);
  const caseRow = getCase(db, caseId);
  const transcript = currentTranscript(db, caseId);
  const run = db.select().from(analysisRuns).where(and(eq(analysisRuns.caseId, caseId), eq(analysisRuns.status, "succeeded"))).orderBy(desc(analysisRuns.runNo)).limit(1).get();
  const sessions = db.select().from(reviewSessions).where(and(eq(reviewSessions.caseId, caseId), eq(reviewSessions.mode, "baseline"))).orderBy(desc(reviewSessions.startedAt)).all();
  return {
    case: { id: caseRow.id, title: caseRow.title, issuer: caseRow.issuer, ticker: caseRow.ticker, status: caseRow.status },
    transcript: transcript ? { versionNo: transcript.versionNo, turns: turnsOfVersion(db, transcript.id).map((t) => ({ label: t.label, speaker: t.speaker, speakerName: t.speakerName, timestamp: t.timestamp, text: t.text })) } : null,
    summary: run?.callSummary ?? null,
    summarySource: run?.source ?? null,
    sessions: sessions.map((s) => ({ id: s.id, actorId: s.actorId, startedAt: s.startedAt, endedAt: s.endedAt, activeMs: s.activeMs, outcome: fromJson<BaselineDecision | null>(s.outcomeJson, null) })),
  };
}

export function recordBaselineDecision(tx: DbOrTx, caseId: string, input: BaselineDecision, actor: Actor): { activeMs: number } {
  requireReviewer(actor);
  getCase(tx, caseId);
  const open = openSession(tx, caseId, actor.id, "baseline");
  if (!open) throw unprocessable("no baseline review is in progress; open the baseline page to start the timer");
  endSession(tx, caseId, actor.id, "baseline", input);
  const closed = tx.select().from(reviewSessions).where(eq(reviewSessions.id, open.id)).get()!;
  appendAudit(tx, { actorId: actor.id, type: "BASELINE_REVIEW_RECORDED", entityType: "review_session", entityId: open.id, caseId, payload: { outcome: input.outcome, flagged_turns: input.flaggedTurns, active_ms: closed.activeMs } });
  return { activeMs: closed.activeMs };
}
