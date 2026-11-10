/**
 * Case status (§9.3). The status is never set directly: every change goes
 * through `transitionCase` and is audited. `syncCaseStatus` recomputes review
 * readiness after any mutation that could affect it.
 */
import { and, desc, eq } from "drizzle-orm";
import { type CaseEvent, type ReadinessBlocker, reviewBlockers, transitionCase } from "@/core/workflow/case";
import { appendAudit } from "../audit/log";
import type { DbOrTx } from "../db/client";
import { attestations, cases, findings } from "../db/schema";
import { unprocessable } from "../errors";
import { findingLabel, latestDecision, openBlockingIssues } from "./findingsCore";
import { type CaseRow, currentTranscript, getCase } from "./loaders";

export function applyCaseEvent(tx: DbOrTx, caseRow: CaseRow, event: CaseEvent, audit: { actorId: string; cause: string }, options: { strict?: boolean } = {}): CaseRow {
  const result = transitionCase(caseRow.status, event);
  if (!result.ok) {
    if (options.strict) throw unprocessable(result.message);
    return caseRow;
  }
  if (!result.changed) return caseRow;
  const next: CaseRow = { ...caseRow, status: result.next, version: caseRow.version + 1 };
  tx.update(cases).set({ status: next.status, version: next.version }).where(eq(cases.id, caseRow.id)).run();
  appendAudit(tx, {
    actorId: audit.actorId,
    type: "CASE_STATUS_CHANGED",
    entityType: "case",
    entityId: caseRow.id,
    caseId: caseRow.id,
    payload: { from: caseRow.status, to: next.status, event, cause: audit.cause },
  });
  return next;
}

export function latestAttestation(tx: DbOrTx, caseId: string) {
  return tx.select().from(attestations).where(and(eq(attestations.caseId, caseId), eq(attestations.kind, "whole_call_review"))).orderBy(desc(attestations.createdAt), desc(attestations.id)).limit(1).get() ?? null;
}

/** Everything that currently stops the case from being READY_FOR_APPROVAL. */
export function computeReviewBlockers(tx: DbOrTx, caseId: string): ReadinessBlocker[] {
  const transcript = currentTranscript(tx, caseId);
  const rows = tx.select().from(findings).where(eq(findings.caseId, caseId)).all();
  const attestation = latestAttestation(tx, caseId);
  return reviewBlockers({
    findings: rows.map((f) => {
      const decision = latestDecision(tx, f.id);
      return { id: f.id, label: findingLabel(f), state: f.state, decision: decision ? { stale: decision.stale, outcome: decision.outcome } : null };
    }),
    openBlockingIssues: openBlockingIssues(tx, caseId).map((i) => ({ code: i.code, message: i.message })),
    attestation: attestation ? { stale: attestation.stale, transcriptVersionId: attestation.transcriptVersionId } : null,
    currentTranscriptVersionId: transcript?.id ?? null,
    currentTranscriptLabel: transcript ? `transcript v${transcript.versionNo}` : "the transcript",
  });
}

/**
 * Brings the case status in line with the review state:
 *  STALE → IN_REVIEW once re-evaluation has run; IN_REVIEW ↔ READY_FOR_APPROVAL
 *  as blockers clear or reappear; APPROVED/RELEASED → STALE → IN_REVIEW if a
 *  blocker reappears after approval.
 */
export function syncCaseStatus(tx: DbOrTx, caseId: string, audit: { actorId: string; cause: string }): CaseRow {
  let row = getCase(tx, caseId);
  if (row.status === "INTAKE" || row.status === "ANALYZING" || row.status === "ANALYSIS_FAILED") return row;
  if (row.status === "STALE") row = applyCaseEvent(tx, row, "REEVALUATED", audit);
  const blockers = computeReviewBlockers(tx, caseId);
  if (blockers.length === 0) {
    row = applyCaseEvent(tx, row, "REVIEW_COMPLETE", audit);
  } else {
    row = applyCaseEvent(tx, row, "REVIEW_INCOMPLETE", audit);
    if (row.status === "STALE") row = applyCaseEvent(tx, row, "REEVALUATED", audit);
  }
  return row;
}
