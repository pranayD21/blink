/**
 * Append-only, hash-chained audit log (decision D14, scope item 9).
 *
 * Each event stores the hash of the previous event; an event's own hash
 * covers every field including that link. Editing or deleting any row breaks
 * the chain from that point, which `verifyAuditChain` reports.
 */
import { asc, desc, eq } from "drizzle-orm";
import { hashOf } from "@/core/deps/hash";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, toJson } from "../db/client";
import { auditEvents } from "../db/schema";
import { newId } from "../ids";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditInput {
  actorId: string;
  type: string;
  entityType: string;
  entityId: string;
  caseId?: string | null;
  payload?: Record<string, unknown>;
}

interface Hashable {
  seq: number;
  ts: string;
  actorId: string;
  type: string;
  entityType: string;
  entityId: string;
  caseId: string | null;
  payload: unknown;
  prevHash: string;
}

export function auditHash(e: Hashable): string {
  return hashOf({ seq: e.seq, ts: e.ts, actor_id: e.actorId, type: e.type, entity_type: e.entityType, entity_id: e.entityId, case_id: e.caseId, payload: e.payload, prev_hash: e.prevHash });
}

/**
 * Appends one event. Must run inside the caller's write transaction so the
 * sequence number and the chain link are assigned atomically with the change
 * they describe.
 */
export function appendAudit(tx: DbOrTx, input: AuditInput): { id: string; seq: number; hash: string } {
  const last = tx.select({ seq: auditEvents.seq, hash: auditEvents.hash }).from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1).get();
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const ts = nowIso();
  // Round-trip the payload so the hash covers exactly what is stored.
  const payloadJson = toJson(input.payload ?? {});
  const payload = JSON.parse(payloadJson) as unknown;
  const caseId = input.caseId ?? null;
  const hash = auditHash({ seq, ts, actorId: input.actorId, type: input.type, entityType: input.entityType, entityId: input.entityId, caseId, payload, prevHash });
  const id = newId("aud");
  tx.insert(auditEvents).values({ id, seq, ts, actorId: input.actorId, type: input.type, entityType: input.entityType, entityId: input.entityId, caseId, payloadJson, prevHash, hash }).run();
  return { id, seq, hash };
}

export type ChainVerification = { ok: true; count: number; headHash: string } | { ok: false; count: number; brokenSeq: number; reason: string };

/** Recomputes the whole chain and reports the first broken sequence number. */
export function verifyAuditChain(db: DbOrTx): ChainVerification {
  const rows = db.select().from(auditEvents).orderBy(asc(auditEvents.seq)).all();
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return { ok: false, count: rows.length, brokenSeq: expectedSeq, reason: `event ${expectedSeq} is missing (found ${row.seq})` };
    }
    if (row.prevHash !== prevHash) {
      return { ok: false, count: rows.length, brokenSeq: row.seq, reason: "its link to the previous event does not match" };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(row.payloadJson);
    } catch {
      return { ok: false, count: rows.length, brokenSeq: row.seq, reason: "its payload is not valid JSON" };
    }
    const hash = auditHash({ seq: row.seq, ts: row.ts, actorId: row.actorId, type: row.type, entityType: row.entityType, entityId: row.entityId, caseId: row.caseId, payload, prevHash: row.prevHash });
    if (hash !== row.hash) {
      return { ok: false, count: rows.length, brokenSeq: row.seq, reason: "its content does not match its hash" };
    }
    prevHash = row.hash;
    expectedSeq++;
  }
  return { ok: true, count: rows.length, headHash: prevHash };
}

export interface AuditEventView {
  id: string;
  seq: number;
  ts: string;
  actorId: string;
  type: string;
  entityType: string;
  entityId: string;
  caseId: string | null;
  payload: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export function listAudit(db: DbOrTx, caseId?: string | null): AuditEventView[] {
  const base = db.select().from(auditEvents);
  const rows = caseId ? base.where(eq(auditEvents.caseId, caseId)).orderBy(asc(auditEvents.seq)).all() : base.orderBy(asc(auditEvents.seq)).all();
  return rows.map((r) => ({ id: r.id, seq: r.seq, ts: r.ts, actorId: r.actorId, type: r.type, entityType: r.entityType, entityId: r.entityId, caseId: r.caseId, payload: fromJson<Record<string, unknown>>(r.payloadJson, {}), prevHash: r.prevHash, hash: r.hash }));
}
