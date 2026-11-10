/** Job `extract_doc_facts` (§11.1): one model call per curated document, then quote verification. */
import { groundDocFacts } from "@/core/extraction/ground";
import { LlmDocFactsSchema } from "@/core/extraction/schema";
import { fromJson, getDb, transact } from "../../db/client";
import { structuredCall } from "../../llm/client";
import { DOCFACTS_PROMPT_VERSION, DOCFACTS_STAGE, DOCFACTS_SYSTEM, buildDocFactsUser } from "../../llm/prompts/docfacts";
import { getDocument, markDocumentFactsFailed, saveDocumentFacts } from "../../services/documents";
import type { JobRow } from "../queue";

export async function extractFactsForDocument(documentId: string): Promise<{ facts: number; dropped: number; replayed: boolean }> {
  const doc = getDocument(getDb(), documentId);
  if (doc.factsStatus === "extracted") return { facts: fromJson<unknown[]>(doc.factsJson, []).length, dropped: 0, replayed: false };
  const result = await structuredCall({
    stage: DOCFACTS_STAGE,
    promptVersion: DOCFACTS_PROMPT_VERSION,
    schema: LlmDocFactsSchema,
    system: DOCFACTS_SYSTEM,
    user: buildDocFactsUser({ title: doc.title, sourceType: doc.sourceType, issuer: doc.issuer, relatedIssuers: fromJson<string[]>(doc.relatedIssuersJson, []), publishedAt: doc.publishedAt, body: doc.body }),
    effort: "medium",
    maxTokens: 16000,
    ref: { documentId },
  });
  const grounded = groundDocFacts(result.data, doc.body);
  transact((tx) => saveDocumentFacts(tx, documentId, grounded.facts, result.callId, grounded.dropped));
  return { facts: grounded.facts.length, dropped: grounded.dropped.length, replayed: result.replayed };
}

export async function extractDocFacts(job: JobRow): Promise<Record<string, unknown>> {
  const { documentId } = fromJson<{ documentId: string }>(job.payloadJson, { documentId: "" });
  return { documentId, ...(await extractFactsForDocument(documentId)) };
}

export function extractDocFactsFailed(job: JobRow, error: unknown): void {
  const { documentId } = fromJson<{ documentId: string }>(job.payloadJson, { documentId: "" });
  transact((tx) => markDocumentFactsFailed(tx, documentId, error instanceof Error ? error.message : String(error)));
}
