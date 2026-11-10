/**
 * Whole-call attestation (§9.3, §12.2). A reviewer states they reviewed the
 * entire call, not only the flagged passages. It is mandatory even with zero
 * findings: extraction can miss a claim, and this is the control for that.
 * The attestation depends on every turn of the transcript version.
 */
import { z } from "zod";
import { type Actor, requireReviewer } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import type { DbOrTx } from "../db/client";
import { attestations } from "../db/schema";
import { badRequest, unprocessable, versionConflict } from "../errors";
import { newId } from "../ids";
import { syncCaseStatus } from "./caseStatus";
import { currentTranscript, getCase, turnsOfVersion } from "./loaders";
import { endSession } from "./sessions";
import { type LabeledEdge, recordDependencies } from "./staleness";

export const AttestSchema = z.strictObject({
  /** The transcript version the reviewer read. Attesting to a version that has since been replaced is refused. */
  transcriptVersionId: z.string(),
  expectedVersion: z.number().int().optional(),
});
export type AttestInput = z.infer<typeof AttestSchema>;

export function attestCase(tx: DbOrTx, caseId: string, input: AttestInput, actor: Actor): { attestationId: string; evidenceHash: string; status: string } {
  requireReviewer(actor);
  const caseRow = getCase(tx, caseId);
  if (input.expectedVersion !== undefined && caseRow.version !== input.expectedVersion) throw versionConflict("the case", input.expectedVersion, caseRow.version);
  const transcript = currentTranscript(tx, caseId);
  if (!transcript) throw badRequest("there is no transcript to attest to");
  if (transcript.id !== input.transcriptVersionId) {
    throw unprocessable(`the transcript changed: the current version is v${transcript.versionNo}. Read it before attesting.`, "TRANSCRIPT_CHANGED");
  }
  if (caseRow.status === "INTAKE" || caseRow.status === "ANALYZING" || caseRow.status === "ANALYSIS_FAILED") {
    throw unprocessable(`the case is ${caseRow.status}; wait for analysis to finish before attesting`);
  }

  const turns = turnsOfVersion(tx, transcript.id);
  const edges: LabeledEdge[] = turns.map((t) => ({ sourceType: "turn", sourceId: t.id, sourceHash: t.textHash, sourceLabel: t.label }));
  const id = newId("att");
  const evidenceHash = recordDependencies(tx, caseId, "attestation", id, edges);
  tx.insert(attestations).values({ id, caseId, actorId: actor.id, transcriptVersionId: transcript.id, kind: "whole_call_review", evidenceHash, stale: false, staleReason: null, createdAt: nowIso() }).run();
  appendAudit(tx, { actorId: actor.id, type: "CASE_ATTESTED", entityType: "attestation", entityId: id, caseId, payload: { transcript_version: transcript.versionNo, turns: turns.length, evidence_hash: evidenceHash } });
  endSession(tx, caseId, actor.id, "blink");
  const after = syncCaseStatus(tx, caseId, { actorId: actor.id, cause: "whole-call attestation recorded" });
  return { attestationId: id, evidenceHash, status: after.status };
}
