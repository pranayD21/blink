/**
 * The model client's per-call model, thinking mode and time limit (Task 10).
 * Replay only: nothing here reaches the network.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getDb, resetDbForTests } from "@/server/db/client";
import { llmCalls } from "@/server/db/schema";
import { costUsd, LlmError, LlmTimeout, priceFor, recordingFile, requestHashFor, structuredCall } from "@/server/llm/client";

const RECORDINGS = join(process.cwd(), "fixtures/llm-recordings");
const anyRecording = (stage: string) => join(RECORDINGS, readdirSync(RECORDINGS).find((f) => f.startsWith(`${stage}-`))!);

describe("request hash", () => {
  it("the hash of an existing stage is unchanged", () => {
    const rec = JSON.parse(readFileSync(anyRecording("extract"), "utf8"));
    expect(
      requestHashFor({ stage: "extract", promptVersion: rec.prompt_version, system: rec.request.system, user: rec.request.user, effort: rec.request.effort, maxTokens: rec.request.max_tokens }),
    ).toBe(rec.request_hash);
  });

  it("a model override and thinking-off change the hash", () => {
    const base = { stage: "live_read", promptVersion: "v1", system: "s", user: "u", effort: "low" as const };
    const plain = requestHashFor(base);
    const model = requestHashFor({ ...base, model: "claude-haiku-5-5" });
    const noThinking = requestHashFor({ ...base, thinking: "disabled" });
    const both = requestHashFor({ ...base, model: "claude-haiku-5-5", thinking: "disabled" });
    expect(new Set([plain, model, noThinking, both]).size).toBe(4);
  });

  it("asking for adaptive thinking is the same request as saying nothing", () => {
    const base = { stage: "live_read", promptVersion: "v1", system: "s", user: "u", effort: "low" as const };
    expect(requestHashFor({ ...base, thinking: "adaptive" })).toBe(requestHashFor(base));
  });
});

describe("prices", () => {
  it("prices by model, and an unknown model has no price", () => {
    expect(costUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-haiku-5-5")).toBeCloseTo(0.6);
    expect(costUsd({ input_tokens: 1, output_tokens: 1 }, "some-other-model")).toBeNull();
    expect(priceFor("some-other-model")).toBeNull();
  });

  it("keeps the Opus price when no model is given", () => {
    expect(costUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(24);
    expect(priceFor("claude-opus-5-5")).toEqual({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect(priceFor("claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 });
  });

  it("counts cache tokens at the cache prices", () => {
    expect(costUsd({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 }, "claude-haiku-5-5")).toBeCloseTo(0.135);
  });
});

describe("replay under a model override", () => {
  const saved = process.env.BLINK_RECORDINGS_DIR;
  let dir = "";
  afterEach(() => {
    if (saved === undefined) delete process.env.BLINK_RECORDINGS_DIR;
    else process.env.BLINK_RECORDINGS_DIR = saved;
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("serves a recording made under a model override", async () => {
    resetDbForTests();
    dir = mkdtempSync(join(tmpdir(), "blink-rec-"));
    process.env.BLINK_RECORDINGS_DIR = dir;
    const call = { stage: "live_read", promptVersion: "v1", system: "sys", user: "usr", effort: "low" as const, model: "claude-haiku-5-5", thinking: "disabled" as const };
    const requestHash = requestHashFor(call);
    const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    writeFileSync(
      recordingFile("live_read", requestHash),
      JSON.stringify({
        stage: "live_read",
        request_hash: requestHash,
        model: "claude-haiku-5-5",
        prompt_version: "v1",
        recorded_at: "2026-11-10T00:00:00.000Z",
        latency_ms: 400,
        request: { system: "sys", user: "usr", effort: "low", max_tokens: 32000 },
        response: { id: "msg_x", model: "claude-haiku-5-5", stop_reason: "end_turn", usage, parsed_output: { ok: true } },
      }),
    );
    const result = await structuredCall({ ...call, schema: z.object({ ok: z.boolean() }) });
    expect(result.replayed).toBe(true);
    expect(result.data).toEqual({ ok: true });
    expect(result.requestHash).toBe(requestHash);
  });
});

describe("LlmTimeout", () => {
  it("is a typed, retryable client error", () => {
    const err = new LlmTimeout("live_read", 2500);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.code).toBe("LLM_TIMEOUT");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("live_read");
  });
});

describe("a live call with a time limit", () => {
  afterEach(() => vi.unstubAllGlobals().unstubAllEnvs());

  /** A server that sends its headers at once and then says nothing, as a stalled stream does. */
  const stalledServer = (seen: { body?: Record<string, unknown>; headers?: Headers }) =>
    vi.fn(async (_url: unknown, init: RequestInit) => {
      seen.body = JSON.parse(String(init.body));
      seen.headers = new Headers(init.headers);
      const body = new ReadableStream({
        start(controller) {
          init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

  it("raises LlmTimeout when the stream stalls after the headers, and sends no fallback with a model override", async () => {
    resetDbForTests();
    const seen: { body?: Record<string, unknown>; headers?: Headers } = {};
    vi.stubEnv("BLINK_LLM_MODE", "live");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubGlobal("fetch", stalledServer(seen));
    const started = Date.now();
    const err = await structuredCall({ stage: "live_read", promptVersion: "v1", schema: z.object({ ok: z.boolean() }), system: "s", user: "u", effort: "low", model: "claude-haiku-5-5", thinking: "disabled", timeoutMs: 150, maxRetries: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmTimeout);
    expect((err as LlmTimeout).code).toBe("LLM_TIMEOUT");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(seen.body?.model).toBe("claude-haiku-5-5");
    expect(seen.body?.thinking).toEqual({ type: "disabled" });
    expect(seen.body).not.toHaveProperty("fallbacks");
    expect(seen.headers?.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
  });
});

describe("a live call whose output the SDK cannot parse", () => {
  afterEach(() => vi.unstubAllGlobals().unstubAllEnvs());

  /** A server that streams one text block and stops for `stopReason`, as the API does. */
  const streamingServer = (text: string, stopReason: string, extraDelta: Record<string, unknown> = {}) =>
    vi.fn(async () => {
      const events: [string, unknown][] = [
        ["message_start", { type: "message_start", message: { id: "msg_cut", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 } } }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null, ...extraDelta }, usage: { output_tokens: 16000 } }],
        ["message_stop", { type: "message_stop" }],
      ];
      const body = events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    });

  /** Runs one call against `server`, with a fresh client module: the SDK client keeps the fetch it was built with. */
  async function callWith(server: ReturnType<typeof streamingServer>) {
    resetDbForTests();
    vi.stubEnv("BLINK_LLM_MODE", "live");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
    vi.stubGlobal("fetch", server);
    vi.resetModules();
    const client = await import("@/server/llm/client");
    const err = await client.structuredCall({ stage: "policy_pass_a", promptVersion: "v1", schema: z.object({ ok: z.boolean() }), system: "s", user: "u", effort: "high", maxTokens: 16000, maxRetries: 0 }).catch((e) => e);
    return { client, err, rows: getDb().select().from(llmCalls).all() };
  }

  it("cut off at the token limit: raises LlmTruncated, not an API error, and logs the call with the usage the stream reported", async () => {
    const { client, err, rows } = await callWith(streamingServer('{"ok": tr', "max_tokens"));
    expect(err).toBeInstanceOf(client.LlmTruncated);
    expect((err as { code: string }).code).toBe("LLM_TRUNCATED");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: "policy_pass_a", stopReason: "max_tokens", inputTokens: 1200, outputTokens: 16000, cacheReadTokens: 300, replayed: false });
  });

  it("a refusal in plain text: raises LlmRefusal and logs the call", async () => {
    const { client, err, rows } = await callWith(streamingServer("I can't help with that.", "refusal", { stop_details: { category: "cyber", explanation: "declined" } }));
    expect(err).toBeInstanceOf(client.LlmRefusal);
    expect((err as { code: string }).code).toBe("LLM_REFUSAL");
    expect((err as Error).message).toContain("cyber");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stopReason: "refusal", inputTokens: 1200, outputTokens: 16000, replayed: false });
  });

  it("invalid JSON at end_turn: raises LlmSchemaError and logs the call", async () => {
    const { client, err, rows } = await callWith(streamingServer('{"ok": true,,}', "end_turn"));
    expect(err).toBeInstanceOf(client.LlmSchemaError);
    expect((err as { code: string }).code).toBe("LLM_SCHEMA_ERROR");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stopReason: "end_turn", inputTokens: 1200, outputTokens: 16000, replayed: false });
  });
});
