/**
 * The live reader (Task 11): one finished turn in, grounded claims and the question out.
 * Replay only: recordings are hand-written into a temp directory under the hash of exactly
 * what `readTurn` sends, so nothing here reaches the network.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnHash } from "@/core/deps/hash";
import type { GroundingTurn } from "@/core/extraction/ground";
import type { LlmClaimWire, LlmLiveReadWire } from "@/core/extraction/schema";
import type { CaseContext, ExpertProfile } from "@/core/types";
import { resetDbForTests } from "@/server/db/client";
import { LIVE_MODEL, READ_TIMEOUT_MS, type ReadTurnInput, readTurn } from "@/server/live/reader";
import { recordingFile, requestHashFor, systemBlocks } from "@/server/llm/client";
import { LIVE_PROMPT_VERSION, LIVE_STAGE, LIVE_SYSTEM, buildLiveContext, buildLiveUser } from "@/server/llm/prompts/live";
import { goldReader, halvorsenLiveTurns, scriptedReader } from "../helpers/live";

/** Every option `readTurn` hands the model client; the call still goes through to the real client. */
const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/server/llm/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/llm/client")>();
  return {
    ...actual,
    structuredCall: (opts: Parameters<typeof actual.structuredCall>[0]) => {
      sent.push(opts as unknown as Record<string, unknown>);
      return actual.structuredCall(opts);
    },
  };
});

const ctx: CaseContext = {
  issuer: "Orchard Lane Creamery, Inc.",
  ticker: "OLCR",
  aliases: ["Orchard Lane"],
  callDate: "2026-06-02",
  fiscal: { fiscal_year_end_month: 12, last_reported: { fy: 2026, q: 1, reported_on: "2026-05-05" }, next_report_expected: "2026-08-04" },
};
const expert: ExpertProfile = {
  name: "J. Okafor",
  current_title: "Consultant",
  current_employer: "Self-employed",
  employment: [{ employer: "Orchard Lane Creamery", title: "Route sales manager", start: "2019", end: "2025" }],
  network: "Example Network",
  network_attestation: {},
};
const sampleCase = { ctx, expert, researchQuestions: ["How is frozen-dessert demand holding up this summer?"] };

const turn = (idx: number, speaker: GroundingTurn["speaker"], text: string): GroundingTurn => ({ label: `T${idx}`, idx, speaker, text, textHash: turnHash(text) });
const T1 = turn(1, "analyst", "How are grocery orders looking for the summer?");
const T2 = turn(2, "expert", "Grocery orders are up about ten percent on last year. The pint line is doing most of it.");

const input = (over: Partial<ReadTurnInput> = {}): ReadTurnInput => ({
  ...sampleCase,
  turns: [T1, T2],
  newTurnLabel: "T2",
  claimsSoFar: [],
  ref: { caseId: "case_x", callId: "call_x" },
  ...over,
});

const neutralQuestion: LlmLiveReadWire["question"] = { asks_for_fact: false, subject_kind: "unknown", subject_name: "", metric_category: "none", event_kind: "none", period_relative: "unspecified", scope: "unspecified" };

function wireClaim(quote: string): LlmClaimWire {
  return {
    logical_key: "C1",
    summary: "Grocery orders are up about ten percent year over year.",
    speaker: "expert",
    subject_kind: "industry",
    subject_name: "",
    metric_category: "orders",
    metric_label: "grocery orders",
    event_kind: "none",
    period_label: "",
    period_relative: "current",
    fiscal_year: 0,
    fiscal_quarter: 0,
    calendar_year: 0,
    calendar_quarter: 0,
    value_number: 10,
    value_unit: "percent",
    value_direction: "up",
    value_baseline: "last year",
    scope: "industry_aggregate",
    scope_detail: "",
    knowledge_basis: "unstated",
    access_timing: "not_applicable",
    confidentiality_signals: [],
    qualifications: ["about"],
    is_correction_of: "",
    quotes: [{ turn_id: "T2", quote, role: "primary", supports_fields: ["metric", "value"] }],
    links: [],
    solicited_by_analyst: "no",
    field_uncertainty: [],
  };
}

/** Writes a recording for exactly the request `readTurn` makes for this input. */
function record(i: ReadTurnInput, output: LlmLiveReadWire): void {
  const system = [LIVE_SYSTEM, buildLiveContext(i)];
  const user = buildLiveUser(i);
  const requestHash = requestHashFor({ stage: LIVE_STAGE, promptVersion: LIVE_PROMPT_VERSION, system, user, effort: "low", maxTokens: 2000, model: LIVE_MODEL(), thinking: "disabled" });
  const usage = { input_tokens: 1200, output_tokens: 150, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  writeFileSync(
    recordingFile(LIVE_STAGE, requestHash),
    JSON.stringify({
      stage: LIVE_STAGE,
      request_hash: requestHash,
      model: LIVE_MODEL(),
      prompt_version: LIVE_PROMPT_VERSION,
      recorded_at: "2026-11-10T00:00:00.000Z",
      latency_ms: 600,
      request: { system, user, effort: "low", max_tokens: 2000 },
      response: { id: "msg_live", model: LIVE_MODEL(), stop_reason: "end_turn", usage, parsed_output: output },
    }),
  );
}

describe("readTurn", () => {
  const saved = process.env.BLINK_RECORDINGS_DIR;
  let dir = "";
  beforeEach(() => {
    resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), "blink-live-"));
    process.env.BLINK_RECORDINGS_DIR = dir;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.BLINK_RECORDINGS_DIR;
    else process.env.BLINK_RECORDINGS_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns grounded claims and the question", async () => {
    record(input(), { claims: [wireClaim("Grocery orders are up about ten percent on last year.")], question: neutralQuestion });
    const result = await readTurn(input());
    expect(result.status).toBe("read");
    if (result.status !== "read") return;
    expect(result.claims.length).toBe(1);
    expect(result.claims[0].quotes[0].turnLabel).toBe("T2");
    expect(result.rejected).toEqual([]);
    expect(result.question).toEqual(neutralQuestion);
    expect(result.llmCallId).toMatch(/^llm_/);
    expect(result.readMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects a claim whose quote is not in the turn", async () => {
    record(input(), { claims: [wireClaim("Grocery orders doubled after the spring launch.")], question: neutralQuestion });
    const result = await readTurn(input());
    expect(result.status).toBe("read");
    if (result.status !== "read") return;
    expect(result.claims).toEqual([]);
    expect(result.rejected.length).toBe(1);
  });

  it("keeps only claims with a quote in the newest turn", async () => {
    const i = input({ turns: [T1, T2, turn(3, "analyst", "Thanks. And pricing?")], newTurnLabel: "T3", claimsSoFar: [{ logicalKey: "C1", summary: "Grocery orders are up." }] });
    record(i, { claims: [wireClaim("Grocery orders are up about ten percent on last year.")], question: neutralQuestion });
    const result = await readTurn(i);
    expect(result.status).toBe("read");
    if (result.status !== "read") return;
    expect(result.claims).toEqual([]);
    expect(result.rejected.map((r) => r.logicalKey)).toEqual(["C1"]);
  });

  it("a replay miss is an error result, not a throw", async () => {
    const result = await readTurn(input({ newTurnLabel: "T1", turns: [T1] }));
    expect(result.status).toBe("error");
    if (result.status === "read") return;
    expect(result.message).toContain("live_read");
    expect(result.llmCallId).toBeNull();
  });

  it("calls the fast model with thinking off and the turn's time limit", async () => {
    sent.length = 0;
    await readTurn(input());
    expect(READ_TIMEOUT_MS).toBe(2500);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      stage: LIVE_STAGE,
      promptVersion: LIVE_PROMPT_VERSION,
      system: [LIVE_SYSTEM, buildLiveContext(input())],
      user: buildLiveUser(input()),
      model: LIVE_MODEL(),
      thinking: "disabled",
      effort: "low",
      maxTokens: 2000,
      timeoutMs: 2500,
      maxRetries: 0,
      ref: { caseId: "case_x", callId: "call_x" },
    });
  });

  const T3 = turn(3, "analyst", "Is that across the whole country?");
  const T4 = turn(4, "expert", "No, sorry, I misspoke. Grocery orders are flat; it was the pint line that grew ten percent.");
  const correctionInput = () => input({ turns: [T1, T2, T3, T4], newTurnLabel: "T4", claimsSoFar: [{ logicalKey: "C1", summary: "Grocery orders are up about ten percent year over year." }] });
  const correction = (to: string): LlmClaimWire => ({
    ...wireClaim("No, sorry, I misspoke."),
    logical_key: "C2",
    summary: "Grocery orders are flat; the pint line grew ten percent.",
    value_direction: "flat",
    quotes: [{ turn_id: "T4", quote: "Grocery orders are flat; it was the pint line that grew ten percent.", role: "primary", supports_fields: ["metric", "value"] }],
    links: [{ to, kind: "corrects" }],
    is_correction_of: to,
  });

  it("a correction of a claim read on an earlier turn keeps its link", async () => {
    record(correctionInput(), { claims: [correction("C1")], question: neutralQuestion });
    const result = await readTurn(correctionInput());
    if (result.status !== "read") throw new Error(`expected a read, got ${result.status}`);
    expect(result.claims.map((c) => c.logicalKey)).toEqual(["C2"]);
    expect(result.claims[0].fields.is_correction_of).toBe("C1");
    expect(result.claims[0].links).toEqual([{ to: "C1", kind: "corrects" }]);
    expect(result.issues.filter((i) => i.code === "LINK_TARGET_MISSING")).toEqual([]);
  });

  it("a correction of a claim that was never read is dropped and reported", async () => {
    record(correctionInput(), { claims: [{ ...correction("C9"), links: [] }], question: neutralQuestion });
    const result = await readTurn(correctionInput());
    if (result.status !== "read") throw new Error(`expected a read, got ${result.status}`);
    expect(result.claims[0].fields.is_correction_of).toBeNull();
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "LINK_TARGET_MISSING", ref: { claim: "C2", target: "C9" } }));
  });

  it("a link to a claim that was never read is dropped and reported", async () => {
    record(correctionInput(), { claims: [{ ...correction("C9"), is_correction_of: "" }], question: neutralQuestion });
    const result = await readTurn(correctionInput());
    if (result.status !== "read") throw new Error(`expected a read, got ${result.status}`);
    expect(result.claims[0].links).toEqual([]);
    expect(result.claims[0].fields.is_correction_of).toBeNull();
    expect(result.issues.filter((i) => i.code === "LINK_TARGET_MISSING")).toEqual([expect.objectContaining({ ref: { claim: "C2", target: "C9" } })]);
  });
});

describe("the live prompt", () => {
  it("the user text carries no ids or times", () => {
    const sample = { turns: [T1, T2], newTurnLabel: "T2", claimsSoFar: [{ logicalKey: "C1", summary: "Grocery orders are up." }] };
    expect(buildLiveUser(sample)).not.toMatch(/call_|case_|\d{4}-\d{2}-\d{2}T/);
    expect(buildLiveUser(sample)).toContain('<turn id="T2" speaker="expert">');
  });

  it("the fixed prefix is long enough to cache", () => {
    expect((LIVE_SYSTEM + buildLiveContext(sampleCase)).split(/\s+/).length).toBeGreaterThan(450);
  });

  it("sends one block per system element, the cache marker on the last", () => {
    expect(systemBlocks("only")).toEqual([{ type: "text", text: "only", cache_control: { type: "ephemeral" } }]);
    expect(systemBlocks(["a", "b"])).toEqual([{ type: "text", text: "a" }, { type: "text", text: "b", cache_control: { type: "ephemeral" } }]);
  });

  it("a list of system blocks hashes as the blocks joined by a newline", () => {
    const base = { stage: LIVE_STAGE, promptVersion: LIVE_PROMPT_VERSION, user: "u", effort: "low" as const };
    expect(requestHashFor({ ...base, system: ["a", "b"] })).toBe(requestHashFor({ ...base, system: "a\nb" }));
  });
});

describe("test readers", () => {
  const ref = { caseId: "case_x", callId: "call_x" };
  const liveInput = (n: number): ReadTurnInput => {
    const live = halvorsenLiveTurns().slice(0, n);
    const turns = live.map((t) => ({ label: `T${t.seq}`, idx: t.seq, speaker: t.speaker, text: t.text, textHash: turnHash(t.text) }));
    return { ...sampleCase, turns, newTurnLabel: `T${n}`, claimsSoFar: [], ref };
  };

  it("halvorsenLiveTurns gives every turn a channel and a plausible time", () => {
    const turns = halvorsenLiveTurns();
    expect(turns.length).toBe(22);
    expect(turns[0]).toMatchObject({ seq: 1, speaker: "expert", speechStartMs: 5000 });
    for (const [i, t] of turns.entries()) {
      expect(t.speechEndMs).toBeGreaterThan(t.speechStartMs!);
      if (i + 1 < turns.length) expect(t.speechEndMs).toBeLessThan(turns[i + 1].speechStartMs!);
    }
  });

  it("goldReader gives the source remark's claim only the fields said so far", async () => {
    const reader = goldReader();
    const at5 = await reader(liveInput(5));
    expect(at5.status).toBe("read");
    if (at5.status !== "read") return;
    expect(at5.claims.map((c) => c.logicalKey)).toEqual(["C1"]);
    expect(at5.claims[0].quotes.map((q) => q.turnLabel)).toEqual(["T5"]);
    expect(at5.claims[0].fields.knowledge_basis).toBe("unstated");
    expect(at5.claims[0].fields.subject_entity.kind).toBe("unknown");
    expect(at5.claims[0].fields.value?.number).toBe(20);

    const at11 = await reader(liveInput(11));
    if (at11.status !== "read") throw new Error("expected a read");
    expect(at11.claims.map((c) => c.logicalKey)).toEqual(["C1"]);
    expect(at11.claims[0].fields.knowledge_basis).toBe("internal_system");
    expect(at11.claims[0].fields.access_timing).toBe("after_employment");

    const at2 = await reader(liveInput(2));
    expect(at2).toMatchObject({ status: "read", claims: [], rejected: [], issues: [], llmCallId: "gold", readMs: 0 });
  });

  it("scriptedReader fills a partial read and passes a full result through", async () => {
    const reader = scriptedReader({ T2: { status: "timeout", message: "slow", llmCallId: null, readMs: 2500 }, T3: { question: { ...neutralQuestion, asks_for_fact: true } } });
    expect((await reader(liveInput(2))).status).toBe("timeout");
    const at3 = await reader(liveInput(3));
    expect(at3).toMatchObject({ status: "read", claims: [], rejected: [], issues: [], question: { asks_for_fact: true } });
    expect(await reader(liveInput(4))).toMatchObject({ status: "read", claims: [], question: neutralQuestion });
  });
});
