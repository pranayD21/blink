/**
 * Live calls on the server (spec section 6): a banker starts a call on their own case, then the
 * Mac app posts each finished turn. The fast reader fills the claim form, the existing pure code
 * applies the policy, and the server returns what the pill shows. Every turn is recorded with
 * the read, the rules and the decision, so a pill can always be explained afterwards.
 *
 * No model decides anything here: the reader fills forms, `evaluateClaim`, `probeRuleIds` and
 * `decidePill` decide.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { turnHash } from "@/core/deps/hash";
import { compareClaim, isComparable, toPublicMatchFact } from "@/core/evidence/compare";
import type { GroundedClaim, GroundingTurn } from "@/core/extraction/ground";
import { type MonitorMove, PILL_TEXT, type PillLevel, decidePill } from "@/core/live/pill";
import { probeRuleIds } from "@/core/live/probe";
import type { PublicMatchFact } from "@/core/predicates/registry";
import { type CompiledPolicy, evaluateClaim } from "@/core/runtime/evaluateClaim";
import type { ClaimRecord } from "@/core/types";
import { appendAudit } from "../audit/log";
import { type Actor, requireRole } from "../auth/actor";
import { nowIso, nowMs } from "../clock";
import { type DbOrTx, fromJson, getDb, toJson, transact } from "../db/client";
import { callClaims, callTurns, calls, cases } from "../db/schema";
import { conflict, notFound, unprocessable } from "../errors";
import { newId } from "../ids";
import { LIVE_MODEL, type LiveReader, type ReadTurnResult, readTurn } from "../live/reader";
import { LIVE_PROMPT_VERSION } from "../llm/prompts/live";
import { activePolicyVersion, currentTranscript, getCase, loadCaseBundle, loadDocumentSet, loadPolicy } from "./loaders";

export type CallRow = typeof calls.$inferSelect;
type CallTurnRow = typeof callTurns.$inferSelect;
type CallClaimRow = typeof callClaims.$inferSelect;

// ── Starting a call ─────────────────────────────────────────────────────────

export const StartCallSchema = z.strictObject({ caseId: z.string() });

/**
 * Starts a live call on the banker's own case, before any transcript exists. Pins the policy the
 * call is judged under: the case's version, or the active one when the case has none (the case
 * adopts it too, as the after-call read would). Starting again while a call is live returns it.
 */
export function startCall(tx: DbOrTx, input: z.infer<typeof StartCallSchema>, actor: Actor): CallRow {
  requireRole(actor, "analyst");
  const caseRow = getCase(tx, input.caseId);
  // Another banker's case is not there at all, rather than forbidden: its id says nothing.
  if (caseRow.createdBy !== actor.id) throw notFound("case");

  const live = tx
    .select()
    .from(calls)
    .where(and(eq(calls.caseId, caseRow.id), eq(calls.startedBy, actor.id), eq(calls.status, "live")))
    .orderBy(desc(calls.startedAt))
    .get();
  if (live) return live;

  if (caseRow.status !== "INTAKE" || currentTranscript(tx, caseRow.id)) {
    throw unprocessable("A live call can only be started on a case that has no transcript yet.", "CALL_NOT_ALLOWED");
  }

  const policyVersionId = caseRow.activePolicyVersionId ?? activePolicyVersion(tx)?.id ?? null;
  if (!policyVersionId || !loadPolicy(tx, policyVersionId)) {
    throw unprocessable("No approved policy is active, so a live call has nothing to apply. Activate a policy version first.", "NO_ACTIVE_POLICY");
  }
  if (!caseRow.activePolicyVersionId) {
    tx.update(cases).set({ activePolicyVersionId: policyVersionId, version: caseRow.version + 1 }).where(eq(cases.id, caseRow.id)).run();
  }

  const row: CallRow = {
    id: newId("call"),
    caseId: caseRow.id,
    startedBy: actor.id,
    policyVersionId,
    status: "live",
    startedAt: nowIso(),
    endedAt: null,
    lastAmberAt: null,
    transcriptVersionId: null,
    analysisJobId: null,
    readerModel: LIVE_MODEL(),
    readerPromptVersion: LIVE_PROMPT_VERSION,
    hiddenCount: 0,
    version: 1,
  };
  tx.insert(calls).values(row).run();
  appendAudit(tx, {
    actorId: actor.id,
    type: "CALL_STARTED",
    entityType: "call",
    entityId: row.id,
    caseId: caseRow.id,
    payload: { policy_version: policyVersionId, reader_model: row.readerModel, reader_prompt_version: row.readerPromptVersion },
  });
  return row;
}

/** The call, for the banker who started it. Anyone else gets a 404. */
export function getCallForActor(db: DbOrTx, callId: string, actor: Actor): CallRow {
  const row = db.select().from(calls).where(eq(calls.id, callId)).get();
  if (!row || row.startedBy !== actor.id) throw notFound("call");
  return row;
}

// ── Ingesting a turn ────────────────────────────────────────────────────────

export const TurnSchema = z.strictObject({
  seq: z.number().int().min(1),
  speaker: z.enum(["analyst", "expert"]),
  text: z.string().trim().min(1),
  speechStartMs: z.number().int().min(0).nullable(),
  speechEndMs: z.number().int().min(0),
  speechEndedAt: z.string(),
  transcribedAt: z.string(),
});

export interface TurnDecision {
  seq: number;
  pill: { level: PillLevel; text: string };
  decidedAt: string;
  readStatus: "read" | "timeout" | "refused" | "error";
}

/** One stored monitor state per claim: where each monitor stands after the latest turn. */
interface StoredMonitorState {
  monitorId: string;
  ruleId: string;
  state: string;
}

/** What `call_turns.evaluations_json` holds: everything the rules did on this turn. */
export interface TurnEvaluations {
  policyVersionId: string;
  claims: {
    logicalKey: string;
    publicMatch: PublicMatchFact | null;
    monitors: { monitorId: string; ruleId: string; prevState: string; nextState: string; result: string; transitionId: string | null; conflictFlag: boolean; guardTrace: unknown }[];
  }[];
  /** The question an analyst turn asks, and the rules whose topic it touches. Null when not probed. */
  probe: { question: unknown; ruleIds: string[] } | null;
  /** Grounding and linking issues from the read: nothing the reader dropped is lost. */
  issues: unknown[];
}

const label = (seq: number) => `T${seq}`;

const REVIEW_STATES: ReadonlySet<string> = new Set(["REVIEW_REQUIRED", "ESCALATION_REQUESTED"]);

const decisionOf = (row: CallTurnRow): TurnDecision => ({ seq: row.seq, pill: { level: row.pill, text: PILL_TEXT[row.pill] }, decidedAt: row.decidedAt, readStatus: row.readStatus });

const toClaimRecord = (c: GroundedClaim): ClaimRecord => ({
  logicalKey: c.logicalKey,
  asserted: c.fields,
  verified: null,
  quotes: c.quotes,
  solicitedByAnalyst: c.solicitedByAnalyst,
  conflictFields: c.conflictFields,
  ungroundedFields: c.ungroundedFields,
});

// One promise chain per call, so turn n is read only after turn n - 1 is stored. Kept on globalThis
// so a dev-server module reload does not start a second, unsynchronised chain.
const globals = globalThis as { __blinkCallChains?: Map<string, Promise<unknown>> };
const chains = (globals.__blinkCallChains ??= new Map());

/**
 * Takes one finished turn and returns what the pill shows. Turns of one call are handled strictly
 * in order, one at a time. A re-sent turn returns the decision already stored; a turn that skips
 * a seq is refused. The read happens outside any transaction; everything it leads to is stored in
 * one.
 */
export function ingestTurn(callId: string, input: z.infer<typeof TurnSchema>, actor: Actor, deps: { reader?: LiveReader } = {}): Promise<TurnDecision> {
  const receivedAt = nowIso();
  const previous = chains.get(callId) ?? Promise.resolve();
  const run = previous.then(() => processTurn(callId, input, actor, deps.reader ?? readTurn, receivedAt));
  // The stored tail never rejects, so one failed turn cannot wedge the turns after it.
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(callId, tail);
  void tail.then(() => {
    if (chains.get(callId) === tail) chains.delete(callId);
  });
  return run;
}

async function processTurn(callId: string, raw: z.infer<typeof TurnSchema>, actor: Actor, reader: LiveReader, receivedAt: string): Promise<TurnDecision> {
  const input = TurnSchema.parse(raw);
  const db = getDb();
  const call = getCallForActor(db, callId, actor);
  const textHash = turnHash(input.text);

  const stored = db.select().from(callTurns).where(eq(callTurns.callId, callId)).orderBy(asc(callTurns.seq)).all();
  const same = stored.find((t) => t.seq === input.seq);
  if (same) {
    if (same.textHash !== textHash) throw conflict(`Turn ${input.seq} was already received with different words.`, "TURN_CONFLICT");
    return decisionOf(same);
  }
  if (call.status !== "live") throw conflict("This call has ended; it takes no more turns.", "CALL_NOT_LIVE");
  const last = stored.at(-1)?.seq ?? 0;
  if (input.seq !== last + 1) throw conflict(`Expected turn ${last + 1}, received turn ${input.seq}.`, "TURN_OUT_OF_ORDER", { expected: last + 1, received: input.seq });

  const bundle = loadCaseBundle(db, call.caseId);
  const policy = loadPolicy(db, call.policyVersionId);
  if (!policy) throw unprocessable("The policy this call is judged under can no longer be loaded.", "NO_ACTIVE_POLICY");
  const { comparable } = loadDocumentSet(db, bundle.caseRow.documentSetId);

  const newLabel = label(input.seq);
  const turns: GroundingTurn[] = [...stored, { seq: input.seq, speaker: input.speaker, text: input.text, textHash }].map((t) => ({ label: label(t.seq), idx: t.seq, speaker: t.speaker, text: t.text, textHash: t.textHash }));
  const claimsSoFar = db
    .select()
    .from(callClaims)
    .where(eq(callClaims.callId, callId))
    .all()
    .map((c) => ({ logicalKey: c.logicalKey, summary: fromJson<ClaimRecord | null>(c.recordJson, null)?.asserted.summary ?? "" }));

  // The read awaits the network, so it runs outside any transaction.
  let read: ReadTurnResult;
  const readStarted = nowMs();
  try {
    read = await reader({ ctx: bundle.ctx, expert: bundle.expertProfile, researchQuestions: bundle.researchQuestions, turns, newTurnLabel: newLabel, claimsSoFar, ref: { caseId: call.caseId, callId } });
  } catch (err) {
    // A reader bug must not stop the call: the turn is recorded as not read live, with the cause.
    read = { status: "error", message: `the live reader failed: ${err instanceof Error ? err.message : String(err)}`, llmCallId: null, readMs: nowMs() - readStarted };
  }

  const compiled: CompiledPolicy = { rules: policy.rules, monitors: policy.monitors };
  return transact((tx) => {
    const rulesStarted = nowMs();
    const moves: MonitorMove[] = [];
    const evaluations: TurnEvaluations = { policyVersionId: policy.version.id, claims: [], probe: null, issues: read.status === "read" ? read.issues : [] };
    const existingClaims = new Map<string, CallClaimRow>(tx.select().from(callClaims).where(eq(callClaims.callId, callId)).all().map((c) => [c.logicalKey, c]));

    if (read.status === "read") {
      for (const claim of read.claims) {
        if (claim.fields.speaker !== "expert") continue;
        const record = toClaimRecord(claim);
        const publicMatch = isComparable(record.asserted, bundle.ctx) ? toPublicMatchFact(compareClaim(record.asserted, comparable, bundle.ctx)) : null;
        const existing = existingClaims.get(claim.logicalKey);
        const before = fromJson<StoredMonitorState[]>(existing?.monitorStatesJson, []);
        const evaluation = evaluateClaim({
          claim: record,
          policy: compiled,
          env: { caseContext: bundle.ctx, expert: bundle.expertProfile, publicMatch },
          mode: "full",
          eventType: "CLAIM_EVALUATED",
          eventIdPrefix: `live:${callId}:${input.seq}:${claim.logicalKey}`,
          currentStates: Object.fromEntries(before.map((m) => [m.monitorId, m.state])),
        });

        const addedQuoteThisTurn = claim.quotes.some((q) => q.turnLabel === newLabel);
        for (const run of evaluation.monitors) moves.push({ claimKey: claim.logicalKey, ruleId: run.ruleId, prevState: run.startState, nextState: run.finalState, addedQuoteThisTurn });
        evaluations.claims.push({
          logicalKey: claim.logicalKey,
          publicMatch,
          monitors: evaluation.monitors.map((run) => {
            const step = run.steps[run.steps.length - 1];
            return { monitorId: run.monitorId, ruleId: run.ruleId, prevState: run.startState, nextState: run.finalState, result: step.result, transitionId: step.transitionId, conflictFlag: step.conflictFlag, guardTrace: step.guardTrace };
          }),
        });

        const review = evaluation.monitors.filter((m) => REVIEW_STATES.has(m.finalState)).map((m) => m.ruleId);
        const context = evaluation.monitors.filter((m) => m.finalState === "NEEDS_CONTEXT").map((m) => m.ruleId);
        const flagged = review.length > 0 ? "review_required" : context.length > 0 ? "needs_context" : "none";
        const values = {
          recordJson: toJson(record),
          monitorStatesJson: toJson(evaluation.monitors.map((m): StoredMonitorState => ({ monitorId: m.monitorId, ruleId: m.ruleId, state: m.finalState }))),
          flagged,
          // The rules behind the flag, at the flag's own level.
          ruleIdsJson: toJson([...new Set(flagged === "review_required" ? review : context)]),
          firstFlaggedSeq: existing?.firstFlaggedSeq ?? (flagged === "none" ? null : input.seq),
          updatedAt: nowIso(),
        } as const;
        if (existing) tx.update(callClaims).set(values).where(eq(callClaims.id, existing.id)).run();
        else tx.insert(callClaims).values({ id: `${callId}:${claim.logicalKey}`, callId, logicalKey: claim.logicalKey, ...values }).run();
      }
    }

    let probeIds: string[] = [];
    if (read.status === "read" && input.speaker === "analyst") {
      probeIds = probeRuleIds(read.question, newLabel, { caseContext: bundle.ctx, expert: bundle.expertProfile, publicMatch: null }, compiled);
      evaluations.probe = { question: read.question, ruleIds: probeIds };
    }

    const fresh = tx.select().from(calls).where(eq(calls.id, callId)).get()!;
    const now = nowMs();
    const pill = decidePill({ moves, probeRuleIds: probeIds, msSinceLastAmber: fresh.lastAmberAt ? now - Date.parse(fresh.lastAmberAt) : null });
    const decidedAt = nowIso();
    if (pill.level === "amber") tx.update(calls).set({ lastAmberAt: decidedAt, version: fresh.version + 1 }).where(eq(calls.id, callId)).run();

    const row: CallTurnRow = {
      id: `${callId}:${input.seq}`,
      callId,
      seq: input.seq,
      speaker: input.speaker,
      text: input.text,
      textHash,
      speechStartMs: input.speechStartMs,
      speechEndMs: input.speechEndMs,
      speechEndedAt: input.speechEndedAt,
      transcribedAt: input.transcribedAt,
      receivedAt,
      readMs: read.readMs,
      rulesMs: nowMs() - rulesStarted,
      decidedAt,
      responseReceivedAt: null,
      shownAt: null,
      readStatus: read.status,
      llmCallId: read.llmCallId,
      claimsJson: toJson(read.status === "read" ? read.claims : []),
      evaluationsJson: toJson(evaluations),
      rejectedJson: toJson(read.status === "read" ? read.rejected : []),
      pill: pill.level,
      pillReason: pill.reason,
      pillRuleIdsJson: toJson(pill.ruleIds),
      suppressed: pill.suppressed,
      error: read.status === "read" ? null : read.message,
    };
    tx.insert(callTurns).values(row).run();
    return decisionOf(row);
  });
}
