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
import { callTurns, llmCalls } from "@/server/db/schema";
import { drainJobs } from "@/server/jobs/runner";
import { LIVE_MODEL, type LiveReader } from "@/server/live/reader";
import { LIVE_PROMPT_VERSION } from "@/server/llm/prompts/live";
import { ackTurn, endCall, ingestTurn, recordOutage, startCall } from "@/server/services/live";
import { callTrace, callsOverview } from "@/server/services/observability";
import { seedDatabase } from "@/server/services/seed";
import { CASE, appError, completeReview, user } from "../helpers/db";
import { goldReader, halvorsenLiveTurns } from "../helpers/live";

const CALL_START = Date.parse("2026-11-10T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const at = (ms: number) => setClockForTests(() => new Date(CALL_START + ms));

const halvorsen = halvorsenLiveTurns();
const OUTAGE_AT = 250_000; // 04:10
const READ_MS = 600;
const SHOWN_AFTER = (seq: number) => 900 + seq * 7;

let id = "";
const db = () => getDb();

/** The gold reader, with each read logged to `llm_calls` the way `readTurn` logs a real one. */
function loggedGoldReader(): LiveReader {
  const gold = goldReader();
  return async (input) => {
    const result = await gold(input);
    const llmCallId = `llm_${input.newTurnLabel}`;
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
        inputTokens: 400,
        outputTokens: 90,
        cacheReadTokens: 0,
        latencyMs: READ_MS,
        refJson: toJson({ caseId: CASE, callId: input.ref.callId }),
        createdAt: iso(CALL_START),
      })
      .run();
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

  it("the policy owner sees no call to open", () => expect(callsOverview(db(), user("dana")).recent).toEqual([]));
});

it("a banker is refused both", () => {
  expect(appError(() => callTrace(db(), id, user("priya"))).status).toBe(403);
  expect(appError(() => callsOverview(db(), user("priya"))).status).toBe(403);
});

it("the policy owner may not open a call", () => expect(appError(() => callTrace(db(), id, user("dana"))).status).toBe(403));
