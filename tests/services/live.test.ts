/**
 * Live calls, the server side: starting a call, then ingesting each finished turn into a pill
 * decision. The reader is a test double, so nothing here touches the network.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LlmQuestionWire } from "@/core/extraction/schema";
import type { LiveTurn } from "@/core/live/transcript";
import { listAudit } from "@/server/audit/log";
import type { Actor } from "@/server/auth/actor";
import { setClockForTests } from "@/server/clock";
import { fromJson, getDb, resetDbForTests, transact } from "@/server/db/client";
import { callClaims, callTurns, calls, cases, policyVersions, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { LIVE_MODEL, type LiveReader, type ReadTurnInput } from "@/server/live/reader";
import { LIVE_PROMPT_VERSION } from "@/server/llm/prompts/live";
import { type CallRow, type TurnDecision, getCallForActor, ingestTurn, startCall } from "@/server/services/live";
import { activePolicyVersion } from "@/server/services/loaders";
import { seedDatabase } from "@/server/services/seed";
import { CASE, appError, user } from "../helpers/db";
import { goldReader, halvorsenLiveTurns, scriptedReader } from "../helpers/live";

const CALL_START = Date.parse("2026-11-10T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

let call: CallRow;
let readerInputs: ReadTurnInput[];

const priya = () => user("priya");
const start = (actor: Actor = priya()) => transact((tx) => startCall(tx, { caseId: CASE }, actor));

/** Records every input the reader is given, then delegates. */
const recording =
  (reader: LiveReader): LiveReader =>
  async (input) => {
    readerInputs.push(input);
    return reader(input);
  };

const asInput = (t: LiveTurn) => ({ ...t, speechEndedAt: iso(CALL_START + t.speechEndMs), transcribedAt: iso(CALL_START + t.speechEndMs + 200) });
const halvorsen = halvorsenLiveTurns();
const post = (seq: number, reader: LiveReader = goldReader()) => ingestTurn(call.id, asInput(halvorsen[seq - 1]), priya(), { reader: recording(reader) });
async function postErr(seq: number, reader: LiveReader = goldReader()): Promise<AppError> {
  try {
    await post(seq, reader);
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected an AppError, but nothing was thrown");
}

async function feed(n: number, reader: LiveReader = goldReader()): Promise<TurnDecision[]> {
  const out: TurnDecision[] = [];
  for (let seq = 1; seq <= n; seq++) out.push(await post(seq, reader));
  return out;
}

const turnRow = (seq: number) => getDb().select().from(callTurns).where(and(eq(callTurns.callId, call.id), eq(callTurns.seq, seq))).get()!;
const turnRows = () => getDb().select().from(callTurns).where(eq(callTurns.callId, call.id)).all();
const claimRow = (key: string) => getDb().select().from(callClaims).where(eq(callClaims.id, `${call.id}:${key}`)).get()!;
const claimRows = () => getDb().select().from(callClaims).where(eq(callClaims.callId, call.id)).all();
const callRow = () => getDb().select().from(calls).where(eq(calls.id, call.id)).get()!;

/** A question about the issuer's current bookings: the probe matches it to R1 and R4. */
const BOOKINGS_QUESTION: LlmQuestionWire = { asks_for_fact: true, subject_kind: "issuer", subject_name: "", metric_category: "bookings", event_kind: "none", period_relative: "current", scope: "company_wide" };

beforeEach(async () => {
  resetDbForTests();
  await seedDatabase({ manualPolicy: true, enqueueDocFacts: false, goldDocFacts: true });
  readerInputs = [];
  call = start();
});

afterEach(() => setClockForTests(null));

describe("ingesting a turn", () => {
  it("the first statement shows nothing; the source remark six turns later is red", async () => {
    const d = await feed(11);
    expect(d[4].pill).toEqual({ level: "listening", text: "Listening" }); // T5
    expect(d[10].pill).toEqual({ level: "red", text: "Sounds like inside information. Move on." }); // T11
    expect(d[10].note).toBe("A rule is met. Move on.");
    expect(d[10].note.toLowerCase()).not.toContain("dashboard");
    expect(claimRow("C1").flagged).toBe("review_required");
    expect(claimRow("C1").firstFlaggedSeq).toBe(5); // needs_context from T5, when the figure had no source yet
    expect(fromJson<string[]>(claimRow("C1").ruleIdsJson, [])).toContain("R1");
    expect(d.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    // The turn's record says why: the rule, both states, and the policy version.
    const t11 = turnRow(11);
    expect(t11.pill).toBe("red");
    expect(t11.pillReason).toBe("rule_met");
    expect(fromJson<string[]>(t11.pillRuleIdsJson, [])).toContain("R1");
    const evaluations = fromJson<{ policyVersionId: string; claims: { logicalKey: string; monitors: { ruleId: string; prevState: string; nextState: string; result: string; guardTrace: unknown }[] }[] }>(t11.evaluationsJson, { policyVersionId: "", claims: [] });
    expect(evaluations.policyVersionId).toBe(call.policyVersionId);
    const r1 = evaluations.claims.find((c) => c.logicalKey === "C1")!.monitors.find((m) => m.ruleId === "R1")!;
    expect(r1).toMatchObject({ nextState: "REVIEW_REQUIRED", result: "true" });
    expect(r1.prevState).toBe("NEEDS_CONTEXT"); // carried from T5, not re-derived from scratch
    expect(r1.guardTrace).toBeTruthy();
    expect(t11).toMatchObject({ speaker: "expert", readStatus: "read", llmCallId: "gold", suppressed: false, error: null });

    // Turn 11's read saw every turn so far and the claims already heard.
    const input11 = readerInputs[10];
    expect(input11.newTurnLabel).toBe("T11");
    expect(input11.turns.map((t) => t.label)).toEqual(Array.from({ length: 11 }, (_, i) => `T${i + 1}`));
    expect(input11.claimsSoFar.map((c) => c.logicalKey)).toContain("C1");
    expect(input11.ref).toEqual({ caseId: CASE, callId: call.id });
  });

  it("a claim heard again after it went red raises no second red", async () => {
    const gold = goldReader();
    // From T12 on, the reader keeps returning C1 as it stood at T11.
    const repeating: LiveReader = (input) => (input.newTurnLabel === "T12" || input.newTurnLabel === "T13" ? gold({ ...input, newTurnLabel: "T11" }) : gold(input));
    const d = await feed(13, repeating);
    expect(d[10].pill.level).toBe("red");
    expect(fromJson<{ claims: { logicalKey: string }[] }>(turnRow(12).evaluationsJson, { claims: [] }).claims.map((c) => c.logicalKey)).toEqual(["C1"]);
    expect(d[11].pill).toEqual({ level: "listening", text: "Listening" });
    expect(d[12].pill).toEqual({ level: "listening", text: "Listening" });
    expect(claimRow("C1")).toMatchObject({ flagged: "review_required", firstFlaggedSeq: 5 });
  });

  it("a question a rule restricts is amber, then held back for thirty seconds", async () => {
    const reader = recording(scriptedReader({ T2: { question: BOOKINGS_QUESTION }, T3: { question: BOOKINGS_QUESTION }, T4: { question: BOOKINGS_QUESTION } }));
    const turn = (seq: number, speaker: "analyst" | "expert", atMs: number) => {
      setClockForTests(() => new Date(CALL_START + atMs + 400));
      return ingestTurn(call.id, { seq, speaker, text: `Turn ${seq}.`, speechStartMs: atMs - 1000, speechEndMs: atMs, speechEndedAt: iso(CALL_START + atMs), transcribedAt: iso(CALL_START + atMs + 200) }, priya(), { reader });
    };
    await turn(1, "expert", 5_000);
    const amber = await turn(2, "analyst", 10_000);
    expect(amber.pill).toEqual({ level: "amber", text: "Getting close to inside information. Steer away." });
    expect(callRow().lastAmberAt).toBe(iso(CALL_START + 10_400));
    expect(fromJson<string[]>(turnRow(2).pillRuleIdsJson, []).sort()).toEqual(["R1", "R4"]);
    expect(turnRow(2).pillReason).toBe("question_asks_for_restricted");

    const held = await turn(3, "analyst", 25_000);
    expect(held.pill).toEqual({ level: "listening", text: "Listening" });
    expect(turnRow(3)).toMatchObject({ pill: "listening", pillReason: "question_asks_for_restricted", suppressed: true });
    expect(callRow().lastAmberAt).toBe(iso(CALL_START + 10_400)); // a held-back amber does not restart the wait

    const again = await turn(4, "analyst", 41_000);
    expect(again.pill.level).toBe("amber");
    expect(callRow().lastAmberAt).toBe(iso(CALL_START + 41_400));
  });

  it("a question on the expert's channel is not probed", async () => {
    await post(1, scriptedReader({ T1: { question: BOOKINGS_QUESTION } }));
    expect(turnRow(1)).toMatchObject({ speaker: "expert", pill: "listening", pillReason: "none" });
  });

  it("a reader timeout is recorded and shows nothing", async () => {
    const reader = scriptedReader({ T2: { status: "timeout", message: "the live read took longer than 2500 ms", llmCallId: null, readMs: 2500 } });
    await post(1, reader);
    const d = await post(2, reader);
    expect(d.readStatus).toBe("timeout");
    expect(d.pill).toEqual({ level: "listening", text: "Listening" });
    expect(turnRow(2)).toMatchObject({ readStatus: "timeout", readMs: 2500, llmCallId: null, pill: "listening", error: "the live read took longer than 2500 ms", claimsJson: "[]" });
  });

  it("a reader that throws is recorded as an error and the call goes on", async () => {
    const broken: LiveReader = async () => {
      throw new Error("reader bug");
    };
    const d = await post(1, broken);
    expect(d.readStatus).toBe("error");
    expect(d.pill.level).toBe("listening");
    expect(turnRow(1).error).toMatch(/reader bug/);
    expect((await post(2)).seq).toBe(2);
  });

  it("Review Focus 4: a claim with an invented quote raises nothing and is recorded", async () => {
    const rejected = [{ logicalKey: "C1", summary: "Orders are down about twenty percent.", reason: "its quote from the newest turn was not found" }];
    const reader = scriptedReader({ T3: { claims: [], rejected } });
    await post(1, reader);
    await post(2, reader);
    const d = await post(3, reader);
    expect(d.pill).toEqual({ level: "listening", text: "Listening" });
    expect(fromJson<unknown[]>(turnRow(3).rejectedJson, [])).toEqual(rejected);
    expect(claimRows()).toEqual([]);
  });

  it("Review Focus 2: re-sending a turn returns the same decision and stores it once", async () => {
    await feed(4);
    readerInputs = [];
    const [first, inFlight] = await Promise.all([post(5), post(5)]);
    const later = await post(5);
    expect(inFlight).toEqual(first);
    expect(later).toEqual(first);
    expect(turnRows().filter((t) => t.seq === 5)).toHaveLength(1);
    expect(readerInputs.map((i) => i.newTurnLabel)).toEqual(["T5"]);
    expect(claimRows().map((c) => c.logicalKey)).toEqual(["C1"]);
  });

  it("a re-sent seq with different words is refused", async () => {
    await post(1);
    const err = await ingestTurn(call.id, { ...asInput(halvorsen[0]), text: "Something else entirely." }, priya(), { reader: goldReader() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ status: 409, code: "TURN_CONFLICT" });
  });

  it("Review Focus 1: two turns posted together are read in order, each once", async () => {
    const [a, b] = await Promise.all([post(1), post(2)]);
    expect([a.seq, b.seq]).toEqual([1, 2]);
    expect(readerInputs.map((i) => i.turns.length)).toEqual([1, 2]);
  });

  it("each overlapping turn is read against the claims the turn before it produced", async () => {
    await feed(4);
    readerInputs = [];
    // T5 states the figure; T6 is posted before T5's read is done.
    await Promise.all([post(5), post(6)]);
    expect(readerInputs.map((i) => i.newTurnLabel)).toEqual(["T5", "T6"]);
    expect(readerInputs[1].claimsSoFar.map((c) => c.logicalKey)).toContain("C1");
  });

  it("a gap in seq is refused", async () => {
    const err = await postErr(3);
    expect(err.status).toBe(409);
    expect(err.code).toBe("TURN_OUT_OF_ORDER");
  });

  it("a refused turn does not block the turns after it", async () => {
    await post(1);
    const [gap, next] = await Promise.allSettled([post(3), post(2)]);
    expect(gap.status).toBe("rejected");
    expect(next).toMatchObject({ status: "fulfilled", value: { seq: 2 } });
    expect((await post(3)).seq).toBe(3);
  });

  it("only the banker who started the call can post to it", async () => {
    const err = await ingestTurn(call.id, asInput(halvorsen[0]), user("marcus"), { reader: goldReader() }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 404 });
    expect(turnRows()).toEqual([]);
  });
});

describe("starting a call", () => {
  it("only the banker who owns the case can start, and only once it has no transcript", async () => {
    // The call from beforeEach: pinned to the active policy, with the reader recorded.
    const active = activePolicyVersion(getDb())!;
    expect(call).toMatchObject({ caseId: CASE, startedBy: "user_priya", status: "live", policyVersionId: active.id, readerModel: LIVE_MODEL(), readerPromptVersion: LIVE_PROMPT_VERSION, hiddenCount: 0 });
    expect(getDb().select().from(cases).where(eq(cases.id, CASE)).get()!.activePolicyVersionId).toBe(active.id);
    expect(listAudit(getDb(), CASE).filter((e) => e.type === "CALL_STARTED")).toHaveLength(1);

    // Starting twice returns the same call.
    expect(start().id).toBe(call.id);
    expect(getDb().select().from(calls).all()).toHaveLength(1);

    // Another analyst cannot see the case or the call.
    getDb().insert(users).values({ id: "user_other", name: "Other Analyst", role: "analyst" }).run();
    const other: Actor = { id: "user_other", name: "Other Analyst", role: "analyst" };
    expect(appError(() => start(other)).status).toBe(404);
    expect(appError(() => getCallForActor(getDb(), call.id, other)).status).toBe(404);
    expect(getCallForActor(getDb(), call.id, priya()).id).toBe(call.id);

    // A reviewer is not a banker.
    expect(appError(() => start(user("marcus"))).status).toBe(403);

    // A case past intake cannot take a live call.
    getDb().update(calls).set({ status: "abandoned" }).run();
    getDb().update(cases).set({ status: "IN_REVIEW" }).where(eq(cases.id, CASE)).run();
    const late = appError(() => start());
    expect([late.status, late.code]).toEqual([422, "CALL_NOT_ALLOWED"]);

    // With no active policy there is nothing to apply.
    resetDbForTests();
    await seedDatabase({ enqueueDocFacts: false, goldDocFacts: true });
    const none = appError(() => start());
    expect([none.status, none.code]).toEqual([422, "NO_ACTIVE_POLICY"]);
  });

  it("a case already pinned to a policy version keeps it, even when another is active", () => {
    const active = activePolicyVersion(getDb())!;
    getDb().update(calls).set({ status: "abandoned" }).run();
    getDb().insert(policyVersions).values({ ...active, id: "pv_older", status: "SUPERSEDED", activatedAt: null }).run();
    getDb().update(cases).set({ activePolicyVersionId: "pv_older" }).where(eq(cases.id, CASE)).run();
    expect(start().policyVersionId).toBe("pv_older");
  });
});
