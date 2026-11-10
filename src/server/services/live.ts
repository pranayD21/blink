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
import type { GroundedClaim, GroundingIssue, GroundingTurn } from "@/core/extraction/ground";
import type { LlmQuestionWire } from "@/core/extraction/schema";
import { STAGES, type Stage } from "@/core/live/health";
import { type MonitorMove, PILL_TEXT, type PillLevel, decidePill, endedText } from "@/core/live/pill";
import { probeRuleIds } from "@/core/live/probe";
import { liveTranscriptText } from "@/core/live/transcript";
import type { PublicMatchFact } from "@/core/predicates/registry";
import { type CompiledPolicy, evaluateClaim } from "@/core/runtime/evaluateClaim";
import type { ClaimRecord } from "@/core/types";
import { appendAudit } from "../audit/log";
import { type Actor, requireRole } from "../auth/actor";
import { nowIso, nowMs } from "../clock";
import { type DbOrTx, fromJson, getDb, toJson, transact } from "../db/client";
import { callClaims, callOutages, callTurns, calls, cases, findingPassages, findings, processingIssues } from "../db/schema";
import { AppError, badRequest, conflict, notFound, unprocessable } from "../errors";
import { newId } from "../ids";
import { LIVE_MODEL, type LiveReader, type ReadTurnResult, readTurn } from "../live/reader";
import { LIVE_PROMPT_VERSION } from "../llm/prompts/live";
import { latestRun } from "./analysis";
import { syncCaseStatus } from "./caseStatus";
import { createFinding, findingLabel, openTask } from "./findingsCore";
import { activePolicyVersion, currentTranscript, getCase, loadCaseBundle, loadCurrentClaims, loadDocumentSet, loadPolicy, turnsOfVersion } from "./loaders";
import { uploadTranscript } from "./transcripts";

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

/** Whether the scripted call may run (`/desktop?source=script`): development and tests only, never a deployed Blink. */
export const scriptedCallsAllowed = (): boolean => process.env.BLINK_ALLOW_SCRIPTED_CALLS === "1";

export interface CallableCase {
  id: string;
  title: string;
  issuer: string;
  ticker: string;
}

/**
 * The cases a banker can start a call on: their own, still at intake with no transcript, as
 * `startCall` requires. Names only: nothing said on any call.
 */
export function callableCases(db: DbOrTx, actor: Actor): CallableCase[] {
  if (actor.role !== "analyst") return [];
  return db
    .select({ id: cases.id, title: cases.title, issuer: cases.issuer, ticker: cases.ticker })
    .from(cases)
    .where(and(eq(cases.createdBy, actor.id), eq(cases.status, "INTAKE")))
    .orderBy(desc(cases.createdAt))
    .all()
    .filter((c) => !currentTranscript(db, c.id));
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
  probe: { question: LlmQuestionWire; ruleIds: string[] } | null;
  /** Grounding and linking issues from the read: nothing the reader dropped is lost. */
  issues: GroundingIssue[];
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
    // The call may have been ended while this turn was being read: it is then not part of the call.
    if (tx.select({ status: calls.status }).from(calls).where(eq(calls.id, callId)).get()?.status !== "live") throw conflict("This call has ended; it takes no more turns.", "CALL_NOT_LIVE");
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

/** Resolves once every turn already posted to the call has been stored or refused. */
export function turnsSettled(callId: string): Promise<void> {
  return (chains.get(callId) ?? Promise.resolve()).then(() => undefined);
}

// ── Acknowledgements and outages ────────────────────────────────────────────

export const AckSchema = z.strictObject({ seq: z.number().int().min(1), responseReceivedAt: z.string(), shownAt: z.string() });

/**
 * The Mac app says when the decision for a turn arrived and when the pill showed it. The first
 * acknowledgement stands: a re-sent one changes nothing.
 */
export function ackTurn(tx: DbOrTx, callId: string, raw: z.infer<typeof AckSchema>, actor: Actor): void {
  const input = AckSchema.parse(raw);
  getCallForActor(tx, callId, actor);
  const turn = tx.select().from(callTurns).where(and(eq(callTurns.callId, callId), eq(callTurns.seq, input.seq))).get();
  if (!turn) throw notFound(`turn ${input.seq}`);
  if (turn.shownAt) return;
  tx.update(callTurns).set({ responseReceivedAt: input.responseReceivedAt, shownAt: input.shownAt }).where(eq(callTurns.id, turn.id)).run();
}

export const OutageSchema = z.strictObject({ stage: z.enum(STAGES), startedAt: z.string(), endedAt: z.string().nullable(), cause: z.string().trim().min(1), shownToBanker: z.boolean() });

/** A stage of the live path that was down. An outage still open when the call ends lasts until the end. */
export function recordOutage(tx: DbOrTx, callId: string, raw: z.infer<typeof OutageSchema>, actor: Actor): { outageId: string } {
  const input = OutageSchema.parse(raw);
  const call = getCallForActor(tx, callId, actor);
  if (call.status !== "live") throw conflict("This call has ended; it takes no more outages.", "CALL_NOT_LIVE");
  const started = Date.parse(input.startedAt);
  const ended = input.endedAt === null ? null : Date.parse(input.endedAt);
  if (!Number.isFinite(started) || (ended !== null && !Number.isFinite(ended))) throw badRequest("an outage needs ISO times");
  if (ended !== null && ended < started) throw badRequest("an outage cannot end before it starts");
  const outageId = newId("out");
  tx.insert(callOutages).values({ id: outageId, callId, stage: input.stage, startedAt: input.startedAt, endedAt: input.endedAt, cause: input.cause, shownToBanker: input.shownToBanker }).run();
  return { outageId };
}

// ── Ending a call ───────────────────────────────────────────────────────────

/** What an outage of each stage cost the call, for the warning on the case. */
const GAP_WORDING: Record<Stage, { what: string; lost: string }> = {
  hearing: { what: "Blink could not hear the call", lost: "Speech in this gap is not in the transcript." },
  transcribing: { what: "Blink could not transcribe the call", lost: "Speech in this gap may be missing from the transcript." },
  reading: { what: "Blink could not read the turns", lost: "Turns in this gap were not checked during the call." },
  rules: { what: "Blink could not check the rules", lost: "Turns in this gap were not checked during the call." },
  screen: { what: "The banker's pill could not be updated", lost: "Warnings in this gap may not have reached the banker." },
};

/** A name as the transcript line can carry it: no brackets, colons or line breaks. */
const lineName = (name: string): string => name.replace(/[():\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

/** The turns that go into the transcript, in order. Turn n of the transcript is the nth of these. */
const spokenTurns = (rows: readonly CallTurnRow[]): CallTurnRow[] => [...rows].sort((a, b) => a.seq - b.seq).filter((t) => t.text.trim().length > 0);

/**
 * Ends the banker's live call. A call where the expert never spoke is abandoned: nothing is
 * uploaded and nothing was hidden. Otherwise the turns become the case's first transcript, the
 * after-call read is queued, every outage becomes a warning on the case, and the pill reports
 * how many passages were hidden: one per claim the call flagged.
 */
export function endCall(tx: DbOrTx, callId: string, actor: Actor, options: { source?: "ai" | "gold" } = {}): { hiddenCount: number; pillText: string; jobId: string | null; transcriptVersionId: string | null } {
  const call = getCallForActor(tx, callId, actor);
  if (call.status !== "live") throw conflict("This call has already ended.", "CALL_NOT_LIVE");
  const endedAt = nowIso();
  const turns = spokenTurns(tx.select().from(callTurns).where(eq(callTurns.callId, callId)).all());
  const outages = tx.select().from(callOutages).where(eq(callOutages.callId, callId)).all();

  if (!turns.some((t) => t.speaker === "expert")) {
    tx.update(calls).set({ status: "abandoned", endedAt, hiddenCount: 0, version: call.version + 1 }).where(eq(calls.id, callId)).run();
    appendAudit(tx, { actorId: actor.id, type: "CALL_ENDED", entityType: "call", entityId: callId, caseId: call.caseId, payload: { status: "abandoned", turns: turns.length, outages: outages.length, hidden_count: 0 } });
    return { hiddenCount: 0, pillText: endedText(0), jobId: null, transcriptVersionId: null };
  }

  const { expert } = loadCaseBundle(tx, call.caseId);
  const text = liveTranscriptText(turns, { analyst: lineName(actor.name), expert: lineName(expert.name) });
  const upload = uploadTranscript(tx, call.caseId, { text, filename: "live-call.txt", sourceLabel: "Live call", source: options.source ?? "ai" }, actor);
  const hiddenCount = tx.select().from(callClaims).where(eq(callClaims.callId, callId)).all().filter((c) => c.flagged !== "none").length;
  tx.update(calls)
    .set({ status: "ended", endedAt, transcriptVersionId: upload.transcriptVersionId, analysisJobId: upload.jobId, hiddenCount, version: call.version + 1 })
    .where(eq(calls.id, callId))
    .run();

  for (const outage of outages) {
    const seconds = Math.max(0, Math.round((Date.parse(outage.endedAt ?? endedAt) - Date.parse(outage.startedAt)) / 1000));
    const wording = GAP_WORDING[outage.stage];
    tx.insert(processingIssues)
      .values({
        id: newId("iss"),
        caseId: call.caseId,
        runId: null,
        severity: "warning",
        code: "CALL_GAP",
        message: `${wording.what} for ${seconds} ${seconds === 1 ? "second" : "seconds"} (${outage.cause}). ${wording.lost}`,
        refJson: toJson({ callId, outageId: outage.id, stage: outage.stage, startedAt: outage.startedAt, endedAt: outage.endedAt ?? endedAt }),
        resolved: false,
        createdAt: endedAt,
      })
      .run();
  }

  appendAudit(tx, {
    actorId: actor.id,
    type: "CALL_ENDED",
    entityType: "call",
    entityId: callId,
    caseId: call.caseId,
    payload: { status: "ended", turns: turns.length, outages: outages.length, hidden_count: hiddenCount, transcript_version: upload.transcriptVersionId, job: upload.jobId },
  });
  return { hiddenCount, pillText: endedText(hiddenCount), jobId: upload.jobId, transcriptVersionId: upload.transcriptVersionId };
}

// ── Reconciling live flags with the after-call read ─────────────────────────

const joinAnd = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** Policy finding states in which the after-call read itself holds the passage for compliance. */
const COVERING_STATES: ReadonlySet<string> = new Set(["REVIEW_REQUIRED", "NEEDS_CONTEXT", "ESCALATED", "REOPENED", "DISPOSITIONED"]);

/**
 * Fails closed (spec section 5): every turn a live flag rests on stays hidden until compliance
 * decides. A turn is covered when a policy finding of the after-call read, in a state that holds
 * it for compliance, quotes that turn. A flag with any uncovered turn becomes a `live` finding
 * for compliance, with each uncovered turn as a hidden passage. A flag whose turns cannot be
 * found in the transcript is raised as a warning instead. Runs after the after-call read,
 * whether it succeeded or failed. A no-op when no call owns the transcript.
 */
export function reconcileLiveFlags(tx: DbOrTx, transcriptVersionId: string): { created: string[] } {
  const call = tx.select().from(calls).where(eq(calls.transcriptVersionId, transcriptVersionId)).get();
  if (!call) return { created: [] };
  const flagged = tx.select().from(callClaims).where(eq(callClaims.callId, call.id)).all().filter((c) => c.flagged !== "none");
  if (flagged.length === 0) return { created: [] };

  // Call turn T<seq> is transcript turn T<n>, n its place among the spoken turns.
  const toTranscriptLabel = new Map(spokenTurns(tx.select().from(callTurns).where(eq(callTurns.callId, call.id)).all()).map((t, i) => [label(t.seq), `T${i + 1}`]));
  const transcriptTurns = new Map(turnsOfVersion(tx, transcriptVersionId).map((t) => [t.label, t]));
  const claimTurns = new Map(loadCurrentClaims(tx, call.caseId).map((c) => [c.row.logicalKey, c.turnLabels]));
  const covered = new Set(
    tx
      .select()
      .from(findings)
      .where(and(eq(findings.caseId, call.caseId), eq(findings.origin, "policy")))
      .all()
      .filter((f) => COVERING_STATES.has(f.state))
      .flatMap((f) => (f.claimLogicalKey ? (claimTurns.get(f.claimLogicalKey) ?? []) : [])),
  );
  const readFinished = latestRun(tx, call.caseId)?.status === "succeeded";

  const created: string[] = [];
  for (const row of flagged) {
    const record = fromJson<ClaimRecord | null>(row.recordJson, null);
    const callLabels = [...new Set((record?.quotes ?? []).map((q) => q.turnLabel))];
    const mapped = callLabels.flatMap((l) => {
      const turn = transcriptTurns.get(toTranscriptLabel.get(l) ?? "");
      return turn ? [turn] : [];
    });
    const unmapped = callLabels.filter((l) => !transcriptTurns.has(toTranscriptLabel.get(l) ?? ""));
    if (callLabels.length === 0 || unmapped.length > 0) raiseUnmapped(tx, call, row, unmapped);

    const uncovered = mapped.filter((t) => !covered.has(t.label));
    if (uncovered.length === 0) continue;
    const labels = uncovered.map((t) => t.label);

    const ruleIds = fromJson<string[]>(row.ruleIdsJson, []);
    const rules = ruleIds.length > 0 ? joinAnd(ruleIds.map((r) => `rule ${r}`)) : "a rule";
    const one = labels.length === 1;
    const where = `the expert's ${one ? "statement" : "statements"} in ${joinAnd(labels)}`;
    const what = row.flagged === "review_required" ? `Live guidance flagged ${where}: it met ${rules} during the call.` : `Live guidance flagged ${where}: it could not rule out ${rules} by the end of the call.`;
    const after = readFinished ? `The after-call read raised no policy finding on ${one ? "this turn" : "these turns"}` : "The after-call read did not finish";
    const { finding, created: isNew } = createFinding(tx, {
      caseId: call.caseId,
      claimLogicalKey: null,
      origin: "live",
      title: "Flagged during the call",
      severity: "high",
      state: "REVIEW_REQUIRED",
      reasonCodes: ["LIVE_ONLY", ...ruleIds, ...labels.map((l) => `TURN:${l}`)],
      explanation: `${what} ${after}, so ${one ? "it stays" : "they stay"} hidden from the banker until compliance decides.`,
      dedupeKey: `live:${call.caseId}:${row.id}`,
      createdBy: "system",
      auditPayload: { call: call.id, call_claim: row.id, flagged: row.flagged, turns: labels, rules: ruleIds },
    });
    if (!isNew) continue;
    created.push(finding.id);
    for (const turn of uncovered) tx.insert(findingPassages).values({ id: newId("fp"), findingId: finding.id, turnId: turn.id, startChar: 0, endChar: turn.text.length }).run();
    openTask(tx, {
      caseId: call.caseId,
      findingId: finding.id,
      kind: "review",
      question: `Review ${findingLabel(finding)}: live guidance flagged ${joinAnd(labels)} during the call, and the after-call read did not confirm it.`,
      assignedRole: "reviewer",
      dedupeKey: `live-review:${finding.id}`,
      meta: { live: true, callId: call.id, turns: labels, ruleIds },
      actorId: "system",
    });
  }
  if (created.length > 0) syncCaseStatus(tx, call.caseId, { actorId: "system", cause: "live flag kept for compliance" });
  return { created };
}

/** A live flag whose turns the transcript does not have cannot be hidden: say so, once per flag. */
function raiseUnmapped(tx: DbOrTx, call: CallRow, row: CallClaimRow, unmapped: readonly string[]): void {
  const already = tx
    .select()
    .from(processingIssues)
    .where(and(eq(processingIssues.caseId, call.caseId), eq(processingIssues.code, "LIVE_FLAG_UNMAPPED")))
    .all()
    .some((i) => fromJson<{ callClaimId?: string }>(i.refJson, {}).callClaimId === row.id);
  if (already) return;
  const message =
    unmapped.length === 0
      ? `Live flag ${row.id} (claim ${row.logicalKey}) quotes no turn, so no passage could be hidden for it.`
      : `Live flag ${row.id} (claim ${row.logicalKey}) quotes ${joinAnd(unmapped)}, which the transcript does not have, so ${unmapped.length === 1 ? "that turn" : "those turns"} could not be hidden.`;
  tx.insert(processingIssues)
    .values({ id: newId("iss"), caseId: call.caseId, runId: null, severity: "warning", code: "LIVE_FLAG_UNMAPPED", message, refJson: toJson({ callId: call.id, callClaimId: row.id, turns: unmapped }), resolved: false, createdAt: nowIso() })
    .run();
}

// ── Speech-to-text token ────────────────────────────────────────────────────

const STT_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const sttUnavailable = (why: string) => new AppError(502, "STT_UNAVAILABLE", `Speech-to-text is unavailable: ${why}.`);

/**
 * A 30-second Deepgram token for the banker's live call, so the Mac app never holds the key. The
 * upstream body is never passed on, and the key never appears in an error.
 */
export async function mintSttToken(callId: string, actor: Actor): Promise<{ accessToken: string; expiresIn: number }> {
  const call = getCallForActor(getDb(), callId, actor);
  if (call.status !== "live") throw conflict("This call has ended; it takes no more speech.", "CALL_NOT_LIVE");
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw sttUnavailable("no key is configured");
  let res: Response;
  try {
    res = await fetch(STT_GRANT_URL, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 30 }),
    });
  } catch {
    throw sttUnavailable("the service could not be reached");
  }
  if (res.status !== 200) throw sttUnavailable(`the service answered ${res.status}`);
  let data: { access_token?: unknown; expires_in?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw sttUnavailable("the service sent an unreadable answer");
  }
  if (typeof data.access_token !== "string" || !data.access_token) throw sttUnavailable("the service sent no token");
  return { accessToken: data.access_token, expiresIn: typeof data.expires_in === "number" ? data.expires_in : 30 };
}
