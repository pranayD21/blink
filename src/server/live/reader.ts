/**
 * The live reader: one finished turn of a call in progress, read by the fast model into the
 * typed claim form, then grounded quote by quote. It fills a form; code decides what the
 * banker sees.
 *
 * It never throws for a model failure: a turn it cannot read in time, or at all, comes back as
 * a typed result the caller records, so a slow or failed read is visible and never blocks the call.
 */
import { type GroundedClaim, type GroundingIssue, type GroundingResult, type GroundingTurn, groundExtraction } from "@/core/extraction/ground";
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
  | { status: "read"; claims: GroundedClaim[]; rejected: GroundingResult["rejected"]; issues: GroundingIssue[]; question: LlmQuestionWire; llmCallId: string; readMs: number }
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
  const issues = relinkToEarlierClaims(claims, extraction, input.claimsSoFar, grounding.issues);
  return { status: "read", claims, rejected, issues, question: call.data.question, llmCallId: call.callId, readMs: nowMs() - started };
};

/**
 * Grounding sees only this turn's output, so it drops every link and correction that points at a claim
 * read on an earlier turn. Rebuilds them from the model's output: a target is valid when it is a claim
 * returned now or one of the claims so far. A target that is neither is reported as an issue, never
 * dropped silently. Returns the grounding issues with the link issues replaced by these.
 */
function relinkToEarlierClaims(claims: GroundedClaim[], extraction: LlmExtraction, claimsSoFar: ReadTurnInput["claimsSoFar"], groundingIssues: GroundingIssue[]): GroundingIssue[] {
  const valid = new Set([...claims.map((c) => c.logicalKey), ...claimsSoFar.map((c) => c.logicalKey)]);
  const raw = new Map<string, LlmExtraction["claims"][number]>();
  // The first claim under a key is the one grounding kept.
  for (const c of extraction.claims) if (!raw.has(c.logical_key.trim())) raw.set(c.logical_key.trim(), c);
  const kept = new Set(claims.map((c) => c.logicalKey));
  const issues = groundingIssues.filter((i) => !(i.code === "LINK_TARGET_MISSING" && kept.has(i.ref.claim)));

  for (const claim of claims) {
    const source = raw.get(claim.logicalKey);
    if (!source) continue;
    const key = claim.logicalKey;
    const reachable = (to: string) => to !== key && valid.has(to);
    claim.links = [];
    for (const link of source.links) {
      const to = link.to.trim();
      if (reachable(to)) claim.links.push({ to, kind: link.kind });
      else issues.push({ severity: "warning", code: "LINK_TARGET_MISSING", message: `claim ${key}: link to ${to} dropped (no such claim in this read or earlier)`, ref: { claim: key, target: to } });
    }
    const corrects = claim.links.find((l) => l.kind === "corrects")?.to;
    const stated = source.fields.is_correction_of?.trim() || null;
    const target = corrects ?? (stated && reachable(stated) ? stated : null);
    if (!corrects && stated && !target) issues.push({ severity: "warning", code: "LINK_TARGET_MISSING", message: `claim ${key}: correction of ${stated} dropped (no such claim in this read or earlier)`, ref: { claim: key, target: stated } });
    claim.fields = { ...claim.fields, is_correction_of: target };
  }
  return issues;
}
