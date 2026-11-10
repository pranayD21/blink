/**
 * One call's record and the all-calls overview, as data (spec section 8). The call: every Halvorsen
 * turn read by the gold reader (each read logged as a model call, as the real reader logs it) and
 * acknowledged on screen, one 19-second transcribing outage, the call ended into the hand-labeled
 * after-call read, and the case reviewed (two findings kept hidden, one cleared). Time is pinned,
 * so every offset is exact.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STAGES } from "@/core/live/health";
import { summarizeLatency } from "@/core/live/stats";
import { setClockForTests } from "@/server/clock";
import { getDb, resetDbForTests, toJson, transact } from "@/server/db/client";
import { callTurns, decisions, findingPassages, findings, llmCalls } from "@/server/db/schema";
import { drainJobs } from "@/server/jobs/runner";
import { LIVE_MODEL, type LiveReader } from "@/server/live/reader";
import { LIVE_PROMPT_VERSION } from "@/server/llm/prompts/live";
import { createCase } from "@/server/services/cases";
import { ackTurn, endCall, ingestTurn, recordOutage, startCall } from "@/server/services/live";
import { currentTranscript } from "@/server/services/loaders";
import { callTrace, callsOverview } from "@/server/services/observability";
import { halvorsenCaseInput, seedDatabase } from "@/server/services/seed";
import { CASE, G1, appError, completeReview, findingOn, user } from "../helpers/db";
import { NEUTRAL_QUESTION, goldReader, halvorsenLiveTurns } from "../helpers/live";

const CALL_START = Date.parse("2026-11-10T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
/** The pinned clock: `at` moves it to a time in the call, and a reader moves it on by the time it takes. */
let clock = CALL_START;
const at = (ms: number) => {
  clock = CALL_START + ms;
};

const halvorsen = halvorsenLiveTurns();
const OUTAGE_AT = 250_000; // 04:10
const READ_MS = 600;
const SHOWN_AFTER = (seq: number) => 900 + seq * 7;

let id = "";
const db = () => getDb();

/** Logs a live read to `llm_calls` as `structuredCall` does: with the call's id in `ref_json`, at the current time. */
function logRead(llmCallId: string, ref: { caseId: string; callId: string }, tokens = { input: 400, output: 90 }): void {
  getDb()
    .insert(llmCalls)
    .values({
      id: llmCallId,
      stage: "live_read",
      requestHash: llmCallId,
      model: LIVE_MODEL(),
      promptVersion: LIVE_PROMPT_VERSION,
      requestJson: "{}",
      responseJson: "{}",
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      cacheReadTokens: 0,
      latencyMs: READ_MS,
      refJson: toJson(ref),
      createdAt: iso(clock),
    })
    .run();
}

/** The gold reader, with each read taking READ_MS and logged to `llm_calls` the way `readTurn` logs a real one. */
function loggedGoldReader(): LiveReader {
  const gold = goldReader();
  return async (input) => {
    const result = await gold(input);
    clock += READ_MS;
    const llmCallId = `llm_${input.newTurnLabel}`;
    logRead(llmCallId, input.ref);
    return { ...result, llmCallId, readMs: READ_MS };
  };
}

/** What the overview's speed figures must be made of: shown on screen minus the end of speech. */
const shownMinusSpoken = () =>
  db()
    .select()
    .from(callTurns)
    .all()
    .filter((t) => t.shownAt)
    .map((t) => Date.parse(t.shownAt!) - Date.parse(t.speechEndedAt));

const trace = () => callTrace(db(), id, user("marcus"));
const outageMoment = () => trace().moments.find((m) => m.kind === "outage")!;
const turnMoment = (seq: number) => trace().moments.find((m) => m.kind === "turn" && m.seq === seq)!;

beforeAll(async () => {
  resetDbForTests();
  await seedDatabase({ manualPolicy: true, enqueueDocFacts: false, goldDocFacts: true });
  setClockForTests(() => new Date(clock));
  const priya = user("priya");
  at(0);
  id = transact((tx) => startCall(tx, { caseId: CASE }, priya)).id;

  const reader = loggedGoldReader();
  for (const t of halvorsen) {
    at(t.speechEndMs + 300);
    await ingestTurn(id, { ...t, speechEndedAt: iso(CALL_START + t.speechEndMs), transcribedAt: iso(CALL_START + t.speechEndMs + 200) }, priya, { reader });
    const shown = CALL_START + t.speechEndMs + SHOWN_AFTER(t.seq);
    transact((tx) => ackTurn(tx, id, { seq: t.seq, responseReceivedAt: iso(shown - 50), shownAt: iso(shown) }, priya));
  }
  transact((tx) => recordOutage(tx, id, { stage: "transcribing", startedAt: iso(CALL_START + OUTAGE_AT), endedAt: iso(CALL_START + OUTAGE_AT + 19_000), cause: "the transcription socket closed", shownToBanker: true }, priya));

  at(halvorsen.at(-1)!.speechEndMs + 5_000);
  transact((tx) => endCall(tx, id, priya, { source: "gold" }));
  await drainJobs();
  completeReview();
}, 60_000);

afterAll(() => setClockForTests(null));

describe("one call's record", () => {
  it("one line per moment, in order, with the outage among them", () => {
    const t = callTrace(db(), id, user("marcus"));
    expect(t.moments.map((m) => m.kind)).toContain("outage");
    expect(t.moments.map((m) => m.atMs)).toEqual([...t.moments.map((m) => m.atMs)].sort((a, b) => a - b));
    expect(t.moments.filter((m) => m.kind === "turn").map((m) => m.seq)).toEqual(halvorsen.map((h) => h.seq));
  });

  it("the red moment explains itself step by step", () => {
    const m = callTrace(db(), id, user("marcus")).moments.find((m) => m.level === "red")!;
    expect(m.steps.map((s) => s.name)).toEqual(["Transcribed", "Read", "Rules checked", "Shown", "Hidden", "Reviewed"]);
    expect(m.steps[1]).toMatchObject({ decidedBy: "model" });
    expect(m.steps[1].meta).toMatch(/claude-haiku-5-5 · prompt live-v1 · \d+ tokens in, \d+ out/);
    expect(m.steps[2]).toMatchObject({ decidedBy: "code" });
    expect(m.steps[2].meta).toMatch(/policy .* approved by /);
    expect(m.steps[3].detail).toBe("“Sounds like inside information. Move on.”");
    expect(m.steps[5].decidedBy).toBe("person");
  });

  it("the red moment is T11: its claim links back to T5, and both passages went to legal", () => {
    const m = turnMoment(11);
    expect(m).toMatchObject({ level: "red", speaker: "Expert", text: halvorsen[10].text });
    expect(m.conclusion).toMatch(/^Rule R1.* is met, linking back to 01:\d\d\. Showed “Sounds like inside information\. Move on\.”$/);
    const [transcribed, read, rules, shown, hidden, reviewed] = m.steps;
    expect(transcribed).toMatchObject({ detail: `“${halvorsen[10].text}”`, offsetMs: 0, durationMs: 200 });
    expect(read).toMatchObject({ offsetMs: 300, durationMs: READ_MS });
    expect(read.meta).toBe("claude-haiku-5-5 · prompt live-v1 · 400 tokens in, 90 out · $0.000085");
    expect(rules.detail).toMatch(/^Rule R1\. .*: yes\. .*Result: review required\./);
    expect(rules.meta).toMatch(/^By code, not a model · policy .+, approved by Dana Okafor$/);
    expect(rules.offsetMs).toBe(300 + READ_MS);
    expect(shown).toMatchObject({ decidedBy: "code", offsetMs: SHOWN_AFTER(11) - 50, durationMs: 50 });
    expect(hidden).toMatchObject({ decidedBy: "code", detail: expect.stringMatching(/^01:\d\d and 0\d:\d\d blacked out and sent to compliance\.$/) });
    expect(reviewed).toMatchObject({ decidedBy: "person", detail: "Jordan Ellis sent both to legal." });
    expect(reviewed.meta).toMatch(/^Nov 10, \d\d:\d\d UTC · “.+”$/);
    expect(m.totalMs).toBe(SHOWN_AFTER(11));
  });

  it("a cleared passage says who unhid it, and a quiet turn has no hidden step", () => {
    const margin = turnMoment(17);
    expect(margin.steps.map((s) => s.name)).toContain("Reviewed");
    expect(margin.steps.find((s) => s.name === "Reviewed")!.detail).toBe("Marcus Lee unhid it.");
    expect(margin.steps.find((s) => s.name === "Hidden")!.detail).toMatch(/^\d\d:\d\d blacked out and sent to compliance\.$/);
    const opening = turnMoment(1);
    expect(opening.steps.map((s) => s.name)).toEqual(["Transcribed", "Read", "Rules checked", "Shown"]);
    expect(opening.level).toBe("listening");
  });

  it("when the findings covering the hidden passages disagree, each finding's decision is stated", () => {
    // A live finding, cleared, on T11 alone: F1 sent both T5 and T11 to legal, this one unhid T11.
    const t11 = `${currentTranscript(db(), CASE)!.id}:T11`;
    const text = halvorsen[10].text;
    db().insert(findings).values({ id: "fnd_extra", caseId: CASE, claimLogicalKey: null, origin: "live", title: "Flagged during the call", severity: "high", state: "DISPOSITIONED", dedupeKey: "test:extra", seqNo: 99, createdBy: "system", createdAt: iso(clock) }).run();
    db().insert(findingPassages).values({ id: "fp_extra", findingId: "fnd_extra", turnId: t11, startChar: 0, endChar: text.length }).run();
    db().insert(decisions).values({ id: "dec_extra", caseId: CASE, findingId: "fnd_extra", actorId: "user_marcus", kind: "disposition", outcome: "no_concern", rationale: "Public by now.", evidenceHash: "x", stale: false, createdAt: iso(clock + 1000) }).run();
    try {
      const reviewed = turnMoment(11).steps.find((s) => s.name === "Reviewed")!;
      expect(reviewed.detail).toBe(`F${findingOn(G1).seqNo}: Jordan Ellis sent both to legal. F99: Marcus Lee unhid it.`);
      expect(reviewed).toMatchObject({ decidedBy: "person", meta: expect.stringContaining("“Public by now.”") });
    } finally {
      db().delete(decisions).where(eq(decisions.id, "dec_extra")).run();
      db().delete(findingPassages).where(eq(findingPassages.id, "fp_extra")).run();
      db().delete(findings).where(eq(findings.id, "fnd_extra")).run();
    }
    expect(turnMoment(11).steps.find((s) => s.name === "Reviewed")!.detail).toBe("Jordan Ellis sent both to legal.");
  });

  it("an outage row says what was lost", () => expect(outageMoment().conclusion).toMatch(/^Blink could not hear the call for 19 seconds\. .* Speech in this gap is not in the transcript\.$/));

  it("an outage row sits at its time, broken, with how long it lasted", () => {
    expect(outageMoment()).toMatchObject({ seq: null, speaker: null, atMs: OUTAGE_AT, level: "broken", totalMs: 19_000, steps: [] });
    expect(outageMoment().conclusion).toBe("Blink could not hear the call for 19 seconds. The transcription socket closed. The banker saw “Blink can't hear the call.” Speech in this gap is not in the transcript.");
  });

  it("the counts and the stages", () => {
    const t = trace();
    expect(t.call).toMatchObject({ id, caseId: CASE, startedAt: iso(CALL_START), status: "ended", durationMs: halvorsen.at(-1)!.speechEndMs + 5_000 });
    expect(t.counts).toMatchObject({ turns: halvorsen.length, problems: 1, callsWithoutPrice: 0 });
    expect(t.counts.warnings).toBe(t.moments.filter((m) => m.level === "amber" || m.level === "red").length);
    expect(t.counts.hidden).toBeGreaterThanOrEqual(3);
    expect(t.counts.costUsd).toBeCloseTo(halvorsen.length * ((400 * 0.1 + 90 * 0.5) / 1_000_000), 12);
    expect(t.stages.map((s) => s.stage)).toEqual([...STAGES]);
    expect(t.stages.find((s) => s.stage === "transcribing")).toEqual({ stage: "transcribing", ok: false, note: "dropped once, 19 s" });
    expect(t.stages.filter((s) => s.ok).map((s) => s.stage)).toEqual(["hearing", "reading", "rules", "screen"]);
  });

  it("a call whose model has no known price reports an unknown cost, not zero", () => {
    const one = eq(llmCalls.id, "llm_T3");
    db().update(llmCalls).set({ model: "x" }).where(one).run();
    try {
      const t = trace();
      expect(t.counts.costUsd).toBeNull();
      expect(t.counts.callsWithoutPrice).toBeGreaterThan(0);
      expect(turnMoment(3).steps[1].meta).toBe("x · prompt live-v1 · 400 tokens in, 90 out · cost unknown");
      expect(callsOverview(db(), user("marcus")).typicalCostUsd).toBeNull();
    } finally {
      db().update(llmCalls).set({ model: LIVE_MODEL() }).where(one).run();
    }
  });

  it("a call that does not exist is a 404", () => expect(appError(() => callTrace(db(), "call_nope", user("marcus"))).status).toBe(404));
});

describe("the all-calls overview", () => {
  it("the overview uses percentiles and counts what compliance unhid", () => {
    const o = callsOverview(db(), user("dana"));
    expect(o.latency).toEqual(summarizeLatency(shownMinusSpoken()));
    expect(o.unhidden).toBe(1);
    expect(JSON.stringify(o)).not.toContain("orders fell");
  });

  it("counts calls, turns and problems, newest problem first, and names the call for a reviewer", () => {
    const o = callsOverview(db(), user("marcus"));
    expect(o).toMatchObject({ calls: 1, turns: halvorsen.length, turnsWithProblem: 0 });
    expect(o.hidden).toBeGreaterThanOrEqual(3);
    expect(o.typicalCostUsd).toBeCloseTo(trace().counts.costUsd!, 12);
    expect(o.problems).toEqual([{ at: iso(CALL_START + OUTAGE_AT), callId: id, title: trace().call.title, text: "Blink could not hear the call for 19 seconds (the transcription socket closed)." }]);
    expect(o.recent).toEqual([{ callId: id, title: trace().call.title, startedAt: iso(CALL_START), turns: halvorsen.length, warnings: trace().counts.warnings }]);
    for (const t of halvorsen) expect(JSON.stringify(o)).not.toContain(t.text);
  });

  it("a stage is down when it had an outage in the last hour", () => {
    expect(callsOverview(db(), user("marcus")).stages.find((s) => s.stage === "transcribing")).toMatchObject({ ok: false });
    at(OUTAGE_AT + 19_000 + 3_600_001);
    try {
      expect(callsOverview(db(), user("marcus")).stages.every((s) => s.ok && s.note === null)).toBe(true);
    } finally {
      at(halvorsen.at(-1)!.speechEndMs + 5_000);
    }
  });

  it("the policy owner sees no call to open, and no problem names a call or a case", () => {
    const o = callsOverview(db(), user("dana"));
    expect(o.recent).toEqual([]);
    expect(o.problems).toEqual([{ at: iso(CALL_START + OUTAGE_AT), callId: null, title: "", text: "Blink could not hear the call for 19 seconds (the transcription socket closed)." }]);
    expect(JSON.stringify(o)).not.toContain(id);
    expect(JSON.stringify(o)).not.toContain(trace().call.title);
  });
});

describe("calls whose reads queue, time out or are refused", () => {
  const LATER = 600_000; // these calls start ten minutes after the first
  let queued = "";
  let abandoned = "";
  const priya = () => user("priya");
  const newCase = (title: string) => transact((tx) => createCase(tx, { ...halvorsenCaseInput(), title }, priya())).caseId;
  const turn = (seq: number, speaker: "analyst" | "expert", text: string, endMs: number) => ({
    seq,
    speaker,
    text,
    speechStartMs: endMs - 1_000,
    speechEndMs: endMs,
    speechEndedAt: iso(CALL_START + LATER + endMs),
    transcribedAt: iso(CALL_START + LATER + endMs + 50),
  });

  /** T1, T2: read, READ_MS each. T3: times out after 2.5 s, logging nothing. T4: refused, the paid answer logged with the call's id only. */
  const reader: LiveReader = async (input) => {
    if (input.newTurnLabel === "T3") {
      clock += 2_500;
      return { status: "timeout", message: "the live read took longer than 2.5 s", llmCallId: null, readMs: 2_500 };
    }
    clock += READ_MS;
    if (input.newTurnLabel === "T4") {
      logRead(`llm_refused_${input.ref.callId}`, input.ref, { input: 300, output: 20 });
      return { status: "refused", message: "the model declined the live_read request", llmCallId: null, readMs: READ_MS };
    }
    const llmCallId = `llm_${input.ref.callId}_${input.newTurnLabel}`;
    logRead(llmCallId, input.ref);
    return { status: "read", claims: [], rejected: [], issues: [], question: NEUTRAL_QUESTION, llmCallId, readMs: READ_MS };
  };

  const queuedTrace = () => callTrace(db(), queued, user("marcus"));
  const step = (seq: number, name: string) => queuedTrace().moments.find((m) => m.seq === seq)!.steps.find((s) => s.name === name)!;
  const row = (seq: number) => db().select().from(callTurns).where(eq(callTurns.id, `${queued}:${seq}`)).get()!;

  beforeAll(async () => {
    // A call where only the banker spoke, and that read timed out: abandoned on ending.
    at(LATER);
    abandoned = transact((tx) => startCall(tx, { caseId: newCase("Abandoned call") }, priya())).id;
    at(LATER + 2_100);
    await ingestTurn(abandoned, turn(1, "analyst", "Can you hear me?", 2_000), priya(), { reader: async () => ({ status: "timeout", message: "too slow", llmCallId: null, readMs: 2_500 }) });
    transact((tx) => endCall(tx, abandoned, priya()));

    at(LATER);
    queued = transact((tx) => startCall(tx, { caseId: newCase("Queued call") }, priya())).id;
    // Two people talk over each other: both turns arrive together, and the second waits for the first.
    at(LATER + 5_300);
    await Promise.all([
      ingestTurn(queued, turn(1, "expert", "Demand is steady.", 5_000), priya(), { reader }),
      ingestTurn(queued, turn(2, "analyst", "And pricing?", 5_200), priya(), { reader }),
    ]);
    at(LATER + 9_000);
    await ingestTurn(queued, turn(3, "expert", "Pricing holds.", 8_900), priya(), { reader });
    at(LATER + 13_000);
    await ingestTurn(queued, turn(4, "expert", "Lead times are shorter.", 12_900), priya(), { reader });
  });

  it("a turn that waited in the queue starts its read where the turn before finished, and says so", () => {
    const [read1, rules1, read2, rules2] = [step(1, "Read"), step(1, "Rules checked"), step(2, "Read"), step(2, "Rules checked")];
    expect(read1).toMatchObject({ offsetMs: 300, durationMs: READ_MS });
    expect(read1.detail).not.toContain("Waiting");
    expect(rules1.offsetMs).toBe(300 + READ_MS);
    // Turn 2 ended 200 ms after turn 1 and arrived 100 ms after it ended; its read began when turn 1's rules ended.
    expect(read2).toMatchObject({ offsetMs: 700, durationMs: READ_MS });
    expect(read2.detail).toMatch(/ Waiting: 0\.6 s behind earlier turns before the read began\.$/);
    const end = (seq: number, s: { offsetMs: number | null; durationMs: number | null }) => Date.parse(row(seq).speechEndedAt) + s.offsetMs! + s.durationMs!;
    expect(Date.parse(row(2).speechEndedAt) + read2.offsetMs!).toBeGreaterThanOrEqual(end(1, rules1));
    // The rules end at decided_at.
    expect(end(2, rules2)).toBe(Date.parse(row(2).decidedAt));
  });

  it("a timed-out read is a model call of unknown cost, and no model decided it", () => {
    expect(step(3, "Read")).toMatchObject({ decidedBy: null, meta: "claude-haiku-5-5 · prompt live-v1 · tokens and cost unknown", offsetMs: 100, durationMs: 2_500 });
    expect(step(3, "Read").detail).toBe("Not read live (timeout). The live read took longer than 2.5 s.");
    const t = queuedTrace();
    expect(t.counts).toMatchObject({ turns: 4, problems: 2, costUsd: null, callsWithoutPrice: 1 });
  });

  it("a refused read is priced from the answer the client logged, though no model decided it", () => {
    expect(step(4, "Read")).toMatchObject({ decidedBy: null, meta: "claude-haiku-5-5 · prompt live-v1 · 300 tokens in, 20 out · $0.00004" });
    expect(step(4, "Read").detail).toBe("Not read live (refused). The model declined the live_read request.");
  });

  it("a call where only the banker spoke is not priced into the typical cost", () => {
    expect(callTrace(db(), abandoned, user("marcus")).counts).toMatchObject({ costUsd: null, callsWithoutPrice: 1 });
    const o = callsOverview(db(), user("marcus"));
    expect(o.calls).toBe(3);
    // The queued call's timeout makes the typical cost unknown; the abandoned call's would not have.
    expect(o.typicalCostUsd).toBeNull();
    db().delete(callTurns).where(eq(callTurns.callId, queued)).run();
    expect(callsOverview(db(), user("marcus")).typicalCostUsd).not.toBeNull();
  });
});

it("a banker is refused both", () => {
  expect(appError(() => callTrace(db(), id, user("priya"))).status).toBe(403);
  expect(appError(() => callsOverview(db(), user("priya"))).status).toBe(403);
});

it("the policy owner may not open a call", () => expect(appError(() => callTrace(db(), id, user("dana"))).status).toBe(403));
