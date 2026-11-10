/**
 * Reviewer corrections to claims (§10.6, PATCH /api/claims/:id) and reviewer
 * rulings on public evidence.
 *
 * A correction never overwrites what the expert was recorded as saying: it
 * adds a verified value beside the asserted one and creates a new claim
 * version. The new content hash is what makes dependent decisions reopen.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { canonicalJson, contextFactHash } from "@/core/deps/hash";
import { type VerifiedFields, VerifiedFieldsSchema } from "@/core/extraction/schema";
import type { ClaimFields } from "@/core/types";
import { type Actor, requireReviewer } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, toJson } from "../db/client";
import { claims, contextFacts } from "../db/schema";
import { conflict, notFound, unprocessable } from "../errors";
import { newId } from "../ids";
import { insertClaimVersion, supersedeClaim } from "./claimsCore";
import { reevaluateCase, runComparison } from "./evaluation";
import { type ClaimRow, type LoadedClaim, hydrateClaims, publicMatchKey } from "./loaders";

export const CorrectClaimSchema = z.strictObject({
  /** Fields to verify or correct. */
  verified: VerifiedFieldsSchema.default({}),
  /** Verified fields to withdraw, returning to the asserted value. */
  clear: z.array(z.string()).default([]),
  note: z.string().default(""),
  /** The claim version the reviewer was looking at. */
  expectedVersion: z.number().int(),
});
export type CorrectClaimInput = z.infer<typeof CorrectClaimSchema>;

function loadClaimForEdit(tx: DbOrTx, claimId: string, expectedVersion: number): LoadedClaim {
  const row = tx.select().from(claims).where(eq(claims.id, claimId)).get();
  if (!row) throw notFound("claim");
  if (row.supersededBy || row.versionNo !== expectedVersion) {
    throw conflict(`claim ${row.logicalKey} changed since you loaded it (you have version ${expectedVersion}). Reload and try again.`);
  }
  if (row.status === "rejected") throw unprocessable(`claim ${row.logicalKey} was rejected and cannot be edited`);
  return hydrateClaims(tx, [row])[0];
}

/** Applies verified overrides as a new claim version, then re-compares and re-evaluates. */
export function applyCorrection(
  tx: DbOrTx,
  claim: LoadedClaim,
  change: { verified: VerifiedFields; clear?: string[]; note?: string },
  actor: Actor,
  origin: { source: "reviewer" | "clarification"; taskId?: string },
): ClaimRow {
  const merged: Record<string, unknown> = { ...(claim.record.verified ?? {}) };
  for (const [field, value] of Object.entries(change.verified)) if (value !== undefined) merged[field] = value;
  for (const field of change.clear ?? []) delete merged[field];
  const before = canonicalJson(claim.record.verified ?? {});
  if (canonicalJson(merged) === before) throw unprocessable("no field was changed", "NO_CHANGE");

  const changed: Record<string, { asserted: unknown; verified: unknown }> = {};
  const asserted = claim.record.asserted as unknown as Record<string, unknown>;
  for (const field of new Set([...Object.keys(change.verified), ...(change.clear ?? [])])) {
    changed[field] = { asserted: asserted[field] ?? null, verified: field in merged ? merged[field] : "(withdrawn)" };
  }

  const verified = Object.keys(merged).length > 0 ? (merged as Partial<ClaimFields>) : null;
  const row = insertClaimVersion(tx, {
    caseId: claim.row.caseId,
    runId: claim.row.runId,
    logicalKey: claim.row.logicalKey,
    versionNo: claim.row.versionNo + 1,
    status: verified ? "reviewer_corrected" : "proposed",
    asserted: claim.record.asserted,
    verified,
    meta: claim.meta,
    quotes: claim.quotes.map((q) => ({ turnId: q.turnId, turnTextHash: q.turnTextHash, quote: q.quote, start: q.start, end: q.end, role: q.role, supportsFields: q.supportsFields, normalized: q.normalized })),
    links: claim.links.map((l) => ({ linkedLogicalKey: l.linkedLogicalKey, kind: l.kind as "elaborates" | "corrects" | "attributes_source" | "contradicts" })),
  });
  supersedeClaim(tx, claim.row.id, row.id);
  appendAudit(tx, {
    actorId: actor.id,
    type: "CLAIM_CORRECTED",
    entityType: "claim",
    entityId: row.id,
    caseId: claim.row.caseId,
    payload: { claim: claim.row.logicalKey, version: row.versionNo, fields: changed, source: origin.source, task: origin.taskId ?? null, note: change.note ?? "", old_hash: claim.row.contentHash, new_hash: row.contentHash },
  });
  runComparison(tx, claim.row.caseId, hydrateClaims(tx, [row])[0]);
  return row;
}

export function correctClaim(tx: DbOrTx, claimId: string, input: CorrectClaimInput, actor: Actor): { claimId: string; logicalKey: string; versionNo: number } {
  requireReviewer(actor);
  const claim = loadClaimForEdit(tx, claimId, input.expectedVersion);
  const row = applyCorrection(tx, claim, { verified: input.verified, clear: input.clear, note: input.note }, actor, { source: "reviewer" });
  reevaluateCase(tx, row.caseId, { actorId: actor.id, reason: "claim corrected", eventType: "CONTEXT_UPDATED", eventToken: `claim:${row.id}`, claimKeys: [row.logicalKey] });
  return { claimId: row.id, logicalKey: row.logicalKey, versionNo: row.versionNo };
}

export const PublicMatchReviewSchema = z.strictObject({
  verdict: z.enum(["verified", "rejected", "clear"]),
  note: z.string().default(""),
  documentId: z.string().nullable().default(null),
  factId: z.string().nullable().default(null),
  expectedVersion: z.number().int(),
});
export type PublicMatchReviewInput = z.infer<typeof PublicMatchReviewSchema>;

/**
 * A reviewer confirms or rejects a public source for a claim ("compliance
 * verifies the public source", policy P5). The ruling is bound to the claim's
 * current content hash: if the claim changes, the ruling no longer applies.
 */
export function reviewPublicMatch(tx: DbOrTx, claimId: string, input: PublicMatchReviewInput, actor: Actor): { state: string } {
  requireReviewer(actor);
  const claim = loadClaimForEdit(tx, claimId, input.expectedVersion);
  const caseId = claim.row.caseId;
  const key = publicMatchKey(claim.row.logicalKey);
  const previous = tx.select().from(contextFacts).where(and(eq(contextFacts.caseId, caseId), eq(contextFacts.key, key), eq(contextFacts.source, "reviewer"), isNull(contextFacts.supersededBy))).all();

  let token = `pm-clear:${newId("x")}`;
  let state = "cleared";
  if (input.verdict === "clear") {
    if (previous.length === 0) throw unprocessable("there is no reviewer ruling to withdraw", "NO_CHANGE");
    for (const p of previous) tx.update(contextFacts).set({ supersededBy: "withdrawn" }).where(eq(contextFacts.id, p.id)).run();
  } else {
    const evidenceState = input.verdict === "verified" ? "supported" : "refuted";
    const value = { verdict: input.verdict, note: input.note, actorId: actor.id, documentId: input.documentId, factId: input.factId, claimHash: claim.row.contentHash };
    const id = newId("ctx");
    tx.insert(contextFacts)
      .values({ id, caseId, key, claimLogicalKey: claim.row.logicalKey, valueJson: toJson(value), evidenceState, source: "reviewer", sourceRef: actor.id, contentHash: contextFactHash(key, value, evidenceState), createdAt: nowIso(), supersededBy: null })
      .run();
    for (const p of previous) tx.update(contextFacts).set({ supersededBy: id }).where(eq(contextFacts.id, p.id)).run();
    token = `pm:${id}`;
    state = evidenceState;
  }
  appendAudit(tx, { actorId: actor.id, type: "PUBLIC_MATCH_REVIEWED", entityType: "claim", entityId: claim.row.id, caseId, payload: { claim: claim.row.logicalKey, verdict: input.verdict, note: input.note, document: input.documentId, fact: input.factId } });
  reevaluateCase(tx, caseId, { actorId: actor.id, reason: "public evidence reviewed", eventType: "CONTEXT_UPDATED", eventToken: token, claimKeys: [claim.row.logicalKey] });
  return { state };
}
