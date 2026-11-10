/**
 * The release check (§12.4): one transaction, every condition re-verified on
 * the server, every failure listed.
 *
 * The staleness pass is re-run first, inside the same transaction, so the
 * check sees the evidence as it is now. A blocked attempt still commits what
 * the pass found — those approvals really are stale — and is itself audited.
 */
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { type ReleaseFailure, checkRelease, transitionBrief } from "@/core/workflow/brief";
import { type Actor, requireReviewer } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import type { DbOrTx } from "../db/client";
import { approvals, briefs, releases } from "../db/schema";
import { newId } from "../ids";
import { AUDIENCES, getBrief, ineligibleCitations } from "./briefs";
import { applyCaseEvent, computeReviewBlockers, syncCaseStatus } from "./caseStatus";
import { getCase } from "./loaders";
import { endSession } from "./sessions";
import { runStalenessPass } from "./staleness";

export const ReleaseSchema = z.strictObject({ expectedVersion: z.number().int(), audience: z.enum(AUDIENCES) });
export type ReleaseInput = z.infer<typeof ReleaseSchema>;

export type ReleaseResult = { released: true; releaseId: string; briefHash: string } | { released: false; failures: ReleaseFailure[] };

export function releaseBrief(tx: DbOrTx, briefId: string, input: ReleaseInput, actor: Actor): ReleaseResult {
  requireReviewer(actor);
  const caseId = getBrief(tx, briefId).caseId;

  // Re-run staleness inside the transaction; anything that turns stale here fails the release.
  const newlyStale = runStalenessPass(tx, caseId, actor.id);
  if (newlyStale.length > 0) syncCaseStatus(tx, caseId, { actorId: actor.id, cause: "staleness found during release check" });

  const brief = getBrief(tx, briefId);
  const caseRow = getCase(tx, caseId);
  const approval = tx.select().from(approvals).where(eq(approvals.briefId, brief.id)).orderBy(desc(approvals.createdAt), desc(approvals.id)).limit(1).get() ?? null;

  const failures = checkRelease({
    actorRole: actor.role,
    audience: input.audience,
    expectedBriefVersion: input.expectedVersion,
    brief: { version: brief.version, status: brief.status, contentHash: brief.contentHash, label: `Brief v${brief.versionNo}` },
    latestApproval: approval ? { briefHash: approval.briefHash, audience: approval.audience, stale: approval.stale, staleReason: approval.staleReason } : null,
    caseStatus: caseRow.status,
    reviewBlockers: computeReviewBlockers(tx, caseId),
    ineligibleCitations: ineligibleCitations(tx, brief),
    newlyStale: newlyStale.map((s) => ({ dependent: s.label, reason: s.reason })),
  });

  if (failures.length > 0) {
    appendAudit(tx, { actorId: actor.id, type: "RELEASE_BLOCKED", entityType: "brief", entityId: brief.id, caseId, payload: { version: brief.versionNo, failures: failures.map((f) => ({ code: f.code, message: f.message })) } });
    return { released: false, failures };
  }

  const releaseId = newId("rel");
  const now = nowIso();
  tx.insert(releases).values({ id: releaseId, caseId, briefId: brief.id, actorId: actor.id, briefHash: brief.contentHash, audience: input.audience, releasedAt: now }).run();
  const next = transitionBrief(brief.status, "RELEASE");
  if (next.ok) tx.update(briefs).set({ status: next.next, version: brief.version + 1 }).where(eq(briefs.id, brief.id)).run();
  // An earlier released version is now superseded for the analyst.
  for (const older of tx.select().from(briefs).where(and(eq(briefs.caseId, caseId), eq(briefs.status, "released"))).all()) {
    if (older.id === brief.id) continue;
    tx.update(briefs).set({ status: "stale", staleReason: `superseded by brief v${brief.versionNo}`, version: older.version + 1 }).where(eq(briefs.id, older.id)).run();
  }
  applyCaseEvent(tx, caseRow, "BRIEF_RELEASED", { actorId: actor.id, cause: `brief v${brief.versionNo} released` }, { strict: true });
  endSession(tx, caseId, actor.id, "blink");
  appendAudit(tx, { actorId: actor.id, type: "BRIEF_RELEASED", entityType: "brief", entityId: brief.id, caseId, payload: { version: brief.versionNo, brief_hash: brief.contentHash, audience: input.audience, release: releaseId, approval: approval?.id ?? null } });
  return { released: true, releaseId, briefHash: brief.contentHash };
}
