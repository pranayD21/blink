/**
 * Curated public documents (§11.1). Facts are extracted once by the model
 * (recorded), verified quote-by-quote against the body, and can be marked
 * verified by a reviewer. A document's hash covers its body and its verified
 * facts, so verifying a fact is an evidence change that reopens dependents.
 */
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { sha256Hex } from "@/core/deps/hash";
import type { DocFact } from "@/core/evidence/compare";
import { type Actor, requireReviewer } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, toJson } from "../db/client";
import { cases, documents } from "../db/schema";
import { notFound, versionConflict } from "../errors";
import { reevaluateCase, runComparison } from "./evaluation";
import { type DocumentRow, currentDocumentHash, documentFacts, isEvaluable, loadCurrentClaims } from "./loaders";

export interface DocumentInput {
  id: string;
  title: string;
  sourceType: DocumentRow["sourceType"];
  issuer: string;
  relatedIssuers: string[];
  publishedAt: string;
  urlLabel: string;
  body: string;
}

/** Parses a fixture document: `---` front matter (key: value, `[a, b]` lists) followed by the body. */
export function parseDocumentFile(id: string, text: string): DocumentInput {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text.replace(/\r\n?/g, "\n"));
  if (!match) throw new Error(`document ${id} has no front matter`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  const list = (value: string | undefined) => (value ? value.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean) : []);
  for (const key of ["title", "source_type", "issuer", "published_at", "url_label"]) if (!meta[key]) throw new Error(`document ${id} is missing "${key}"`);
  return { id, title: meta.title, sourceType: meta.source_type as DocumentRow["sourceType"], issuer: meta.issuer, relatedIssuers: list(meta.related_issuers), publishedAt: meta.published_at, urlLabel: meta.url_label, body: match[2].trim() };
}

export function upsertDocument(tx: DbOrTx, input: DocumentInput): void {
  const bodyHash = sha256Hex(input.body);
  const existing = tx.select().from(documents).where(eq(documents.id, input.id)).get();
  if (existing && existing.bodyHash === bodyHash) return;
  const values = { title: input.title, sourceType: input.sourceType, issuer: input.issuer, relatedIssuersJson: toJson(input.relatedIssuers), publishedAt: input.publishedAt, urlLabel: input.urlLabel, body: input.body, bodyHash };
  if (existing) {
    // A changed body invalidates its extracted facts.
    tx.update(documents).set({ ...values, factsJson: "[]", factsStatus: "pending", factsCallId: null, version: existing.version + 1 }).where(eq(documents.id, input.id)).run();
  } else {
    tx.insert(documents).values({ id: input.id, ...values, ingestedAt: nowIso(), factsJson: "[]", factsStatus: "pending", factsCallId: null, version: 1 }).run();
  }
}

export function getDocument(db: DbOrTx, id: string): DocumentRow {
  const row = db.select().from(documents).where(eq(documents.id, id)).get();
  if (!row) throw notFound("document");
  return row;
}

/** Stores extracted facts, keeping a reviewer's verified marks for facts whose quote is unchanged. */
export function saveDocumentFacts(tx: DbOrTx, documentId: string, facts: DocFact[], callId: string | null, dropped: { fact_id: string; reason: string }[]): void {
  const doc = getDocument(tx, documentId);
  const verifiedQuotes = new Set(documentFacts(doc).filter((f) => f.verified).map((f) => f.quote));
  const merged = facts.map((f) => ({ ...f, verified: verifiedQuotes.has(f.quote) }));
  tx.update(documents).set({ factsJson: toJson(merged), factsStatus: "extracted", factsCallId: callId, version: doc.version + 1 }).where(eq(documents.id, documentId)).run();
  appendAudit(tx, { actorId: "system", type: "DOCUMENT_FACTS_EXTRACTED", entityType: "document", entityId: documentId, payload: { title: doc.title, facts: merged.length, dropped: dropped.length, llm_call: callId } });
}

export function markDocumentFactsFailed(tx: DbOrTx, documentId: string, message: string): void {
  tx.update(documents).set({ factsStatus: "failed" }).where(eq(documents.id, documentId)).run();
  appendAudit(tx, { actorId: "system", type: "DOCUMENT_FACTS_FAILED", entityType: "document", entityId: documentId, payload: { message } });
}

export const VerifyFactSchema = z.strictObject({ factId: z.string(), verified: z.boolean(), expectedVersion: z.number().int() });

/** The documents page "verify" toggle. Changes the document hash, so cases that compared against it are re-checked. */
export function setFactVerified(tx: DbOrTx, documentId: string, input: z.infer<typeof VerifyFactSchema>, actor: Actor): { version: number; affectedCases: string[] } {
  requireReviewer(actor);
  const doc = getDocument(tx, documentId);
  if (doc.version !== input.expectedVersion) throw versionConflict("this document", input.expectedVersion, doc.version);
  const facts = documentFacts(doc);
  const fact = facts.find((f) => f.fact_id === input.factId);
  if (!fact) throw notFound(`fact ${input.factId}`);
  if (Boolean(fact.verified) === input.verified) return { version: doc.version, affectedCases: [] };
  fact.verified = input.verified;
  tx.update(documents).set({ factsJson: toJson(facts), version: doc.version + 1 }).where(eq(documents.id, documentId)).run();
  appendAudit(tx, { actorId: actor.id, type: input.verified ? "DOCUMENT_FACT_VERIFIED" : "DOCUMENT_FACT_UNVERIFIED", entityType: "document", entityId: documentId, payload: { title: doc.title, fact: input.factId, quote: fact.quote, document_hash: currentDocumentHash({ ...doc, factsJson: toJson(facts) }) } });

  // Every analyzed case compares claims against the document set, so each is re-checked.
  const affected = tx.select().from(cases).all().filter((c) => c.status !== "INTAKE" && c.status !== "ANALYZING" && c.status !== "ANALYSIS_FAILED").map((c) => c.id);
  for (const caseId of affected) {
    for (const claim of loadCurrentClaims(tx, caseId).filter(isEvaluable)) runComparison(tx, caseId, claim);
    reevaluateCase(tx, caseId, { actorId: actor.id, reason: `document fact ${input.verified ? "verified" : "unverified"}`, eventType: "CONTEXT_UPDATED", eventToken: `doc:${documentId}:${doc.version + 1}` });
  }
  return { version: doc.version + 1, affectedCases: affected };
}

export function listDocuments(db: DbOrTx) {
  const usedBy = db.select({ id: cases.id }).from(cases).all().length;
  return db
    .select()
    .from(documents)
    .orderBy(asc(documents.publishedAt), asc(documents.id))
    .all()
    .map((d) => ({
      id: d.id,
      title: d.title,
      sourceType: d.sourceType,
      issuer: d.issuer,
      relatedIssuers: fromJson<string[]>(d.relatedIssuersJson, []),
      publishedAt: d.publishedAt,
      urlLabel: d.urlLabel,
      body: d.body,
      bodyHash: d.bodyHash,
      hash: currentDocumentHash(d),
      factsStatus: d.factsStatus,
      factsCallId: d.factsCallId,
      facts: documentFacts(d),
      version: d.version,
      casesUsing: usedBy,
    }));
}
