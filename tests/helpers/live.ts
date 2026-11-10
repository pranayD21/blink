/**
 * Readers and turns for live-call tests. No network: the gold reader replays the hand-labeled
 * Halvorsen extraction one turn at a time, and the scripted reader returns what a test asks for.
 */
import { groundExtraction, resetField } from "@/core/extraction/ground";
import { type LlmExtraction, type LlmQuestionWire, LlmExtractionSchema } from "@/core/extraction/schema";
import { EVIDENCE_FIELDS, type EvidenceField } from "@/core/types";
import type { LiveReader, ReadTurnResult } from "@/server/live/reader";
import { readJson } from "./fixtures";

/** The question of a turn that asks for no fact. */
export const NEUTRAL_QUESTION: LlmQuestionWire = {
  asks_for_fact: false,
  subject_kind: "unknown",
  subject_name: "",
  metric_category: "none",
  event_kind: "none",
  period_relative: "unspecified",
  scope: "unspecified",
};

export { halvorsenLiveTurns } from "@/server/services/seed";

const goldExtraction = (): LlmExtraction => LlmExtractionSchema.parse(readJson<{ extraction: unknown }>("cases", "halvorsen", "gold.json").extraction);

const isEvidenceField = (f: string): f is EvidenceField => (EVIDENCE_FIELDS as readonly string[]).includes(f);

/**
 * A reader that knows the answer. For the newest turn Tn: the gold claims that quote Tn, as they
 * stand at Tn: quotes from later turns are dropped, and a field that only those later quotes
 * support is reset to unknown. Claims are grounded against the input turns like a real read.
 */
export function goldReader(): LiveReader {
  const gold = goldExtraction();
  return async (input) => {
    const heard = new Set(input.turns.map((t) => t.label));
    const laterOnly = new Map<string, EvidenceField[]>();
    const claims: LlmExtraction["claims"] = [];
    for (const claim of gold.claims) {
      const kept = claim.quotes.filter((q) => heard.has(q.turn_id));
      if (kept.length === 0) continue;
      const dropped = claim.quotes.filter((q) => !heard.has(q.turn_id));
      const stillSupported = new Set(kept.flatMap((q) => q.supports_fields));
      laterOnly.set(claim.logical_key, [...new Set(dropped.flatMap((q) => q.supports_fields))].filter((f) => isEvidenceField(f) && !stillSupported.has(f)) as EvidenceField[]);
      claims.push({ ...claim, quotes: kept });
    }
    // Ground every claim heard so far, so links between them survive, then keep those this turn adds to.
    const quotesNewest = new Set(claims.filter((c) => c.quotes.some((q) => q.turn_id === input.newTurnLabel)).map((c) => c.logical_key));
    const grounding = groundExtraction({ claims, suggested_concerns: [], missing_context_questions: [], call_summary: "" }, input.turns);
    return {
      status: "read",
      claims: grounding.claims
        .filter((c) => quotesNewest.has(c.logicalKey))
        .map((c) => ({ ...c, fields: (laterOnly.get(c.logicalKey) ?? []).reduce(resetField, c.fields) })),
      rejected: grounding.rejected.filter((r) => quotesNewest.has(r.logicalKey)),
      issues: grounding.issues.filter((i) => quotesNewest.has(i.ref.claim)),
      question: NEUTRAL_QUESTION,
      llmCallId: "gold",
      readMs: 0,
    };
  };
}

type ReadResult = Extract<ReadTurnResult, { status: "read" }>;

/**
 * A reader that returns, for the newest turn's label, the result a test gives: a full result as
 * it is, or a partial read filled in with no claims, no rejections, no issues and a neutral question. A turn
 * with no entry reads as nothing said.
 */
export function scriptedReader(byLabel: Record<string, Partial<ReadResult> | ReadTurnResult>): LiveReader {
  return async (input) => {
    const entry = Object.hasOwn(byLabel, input.newTurnLabel) ? byLabel[input.newTurnLabel] : {};
    if (entry.status !== undefined && entry.status !== "read") return entry as ReadTurnResult;
    return { claims: [], rejected: [], issues: [], question: NEUTRAL_QUESTION, llmCallId: "scripted", readMs: 0, ...(entry as Partial<ReadResult>), status: "read" };
  };
}
