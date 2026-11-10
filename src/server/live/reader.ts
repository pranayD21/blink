/**
 * The live reader: one finished turn of a call in progress, read by the fast model into the
 * typed claim form, then grounded quote by quote. It fills a form; code decides what the
 * banker sees.
 *
 * It never throws for a model failure: a turn it cannot read in time, or at all, comes back as
 * a typed result the caller records, so a slow or failed read is visible and never blocks the call.
 */
import { type GroundedClaim, type GroundingResult, type GroundingTurn, groundExtraction } from "@/core/extraction/ground";
import { type LlmExtraction, type LlmQuestionWire, LlmLiveReadWireSchema, claimFromWire } from "@/core/extraction/schema";
import type { CaseContext, ExpertProfile } from "@/core/types";
import { nowMs } from "../clock";
import { LlmError, LlmRefusal, LlmTimeout, structuredCall } from "../llm/client";
import { LIVE_PROMPT_VERSION, LIVE_STAGE, LIVE_SYSTEM, buildLiveContext, buildLiveUser } from "../llm/prompts/live";

export const LIVE_MODEL = () => process.env.BLINK_LIVE_MODEL || "claude-haiku-5-5";

/** A turn the reader cannot finish in this time is recorded as not read live. */
export const READ_TIMEOUT_MS = 2500;

export interface ReadTurnInput {
  ctx: CaseContext;
  expert: ExpertProfile;
  researchQuestions: string[];
  /** Every turn of the call so far, the newest last. */
  turns: GroundingTurn[];
  newTurnLabel: string;
  claimsSoFar: { logicalKey: string; summary: string }[];
  ref: { caseId: string; callId: string };
}

export type ReadTurnResult =
  | { status: "read"; claims: GroundedClaim[]; rejected: GroundingResult["rejected"]; question: LlmQuestionWire; llmCallId: string; readMs: number }
  | { status: "timeout" | "refused" | "error"; message: string; llmCallId: string | null; readMs: number };

export type LiveReader = (input: ReadTurnInput) => Promise<ReadTurnResult>;

export const readTurn: LiveReader = async (input) => {
  const started = nowMs();
  let call;
  try {
    call = await structuredCall({
      stage: LIVE_STAGE,
      promptVersion: LIVE_PROMPT_VERSION,
      schema: LlmLiveReadWireSchema,
      system: [LIVE_SYSTEM, buildLiveContext(input)],
      user: buildLiveUser(input),
      effort: "low",
      maxTokens: 2000,
      model: LIVE_MODEL(),
      thinking: "disabled",
      timeoutMs: READ_TIMEOUT_MS,
      maxRetries: 0,
      ref: input.ref,
    });
  } catch (err) {
    // Anything that is not an LlmError is a bug, not a model failure, and is left to surface.
    if (!(err instanceof LlmError)) throw err;
    const status = err instanceof LlmTimeout ? "timeout" : err instanceof LlmRefusal ? "refused" : "error";
    return { status, message: err.message, llmCallId: null, readMs: nowMs() - started };
  }

  const extraction: LlmExtraction = { claims: call.data.claims.map(claimFromWire), suggested_concerns: [], missing_context_questions: [], call_summary: "" };
  const grounding = groundExtraction(extraction, input.turns);
  const claims: GroundedClaim[] = [];
  const rejected = [...grounding.rejected];
  for (const claim of grounding.claims) {
    if (claim.quotes.some((q) => q.turnLabel === input.newTurnLabel)) {
      claims.push(claim);
      continue;
    }
    // A claim that survives on earlier quotes alone adds nothing from this turn. Say why it was not used,
    // so an invented quote from the newest turn is recorded rather than lost.
    const proposedNew = call.data.claims.some((c) => c.logical_key.trim() === claim.logicalKey && c.quotes.some((q) => q.turn_id.trim() === input.newTurnLabel));
    rejected.push({ logicalKey: claim.logicalKey, summary: claim.fields.summary, reason: proposedNew ? "its quote from the newest turn was not found" : "no quote from the newest turn" });
  }
  return { status: "read", claims, rejected, question: call.data.question, llmCallId: call.callId, readMs: nowMs() - started };
};
