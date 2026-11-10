/**
 * The one place Blink talks to a model (§13).
 *
 * `structuredCall` sends one request with a Zod-described output format and
 * returns validated data. Model output is data: it is re-validated here and
 * again by the deterministic code that consumes it, and it never changes
 * state by itself.
 *
 * Record and replay (decision D15):
 *   live    call the API, log to llm_calls
 *   record  call the API, log, and write fixtures/llm-recordings/<stage>-<hash>.json
 *   replay  read the recording only; a miss fails with the stage and hash
 * The request hash covers the model, prompt version, system and user text,
 * effort, and schema name, so any prompt edit forces a re-record.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { hashOf } from "@/core/deps/hash";
import { nowIso, nowMs } from "../clock";
import { getDb, toJson } from "../db/client";
import { llmCalls } from "../db/schema";
import { newId } from "../ids";

export type LlmMode = "live" | "record" | "replay";

export function llmMode(): LlmMode {
  const mode = process.env.BLINK_LLM_MODE;
  // Unset or unknown → replay: the safe default never reaches the network.
  return mode === "live" || mode === "record" ? mode : "replay";
}

export const llmModel = () => process.env.BLINK_MODEL || "claude-opus-5-5";

export const RECORDINGS_DIR = () => resolve(process.cwd(), process.env.BLINK_RECORDINGS_DIR ?? "fixtures/llm-recordings");

/** Claude Opus 5.5 list prices per million tokens (§13.2). */
const PRICE_PER_MTOK = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export function costUsd(usage: Pick<LlmUsage, "input_tokens" | "output_tokens"> & Partial<LlmUsage>): number {
  return (
    (usage.input_tokens * PRICE_PER_MTOK.input + usage.output_tokens * PRICE_PER_MTOK.output + (usage.cache_read_input_tokens ?? 0) * PRICE_PER_MTOK.cacheRead + (usage.cache_creation_input_tokens ?? 0) * PRICE_PER_MTOK.cacheWrite) / 1_000_000
  );
}

// ── Errors: every failure is typed and visible; none is swallowed ───────────

export class LlmError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
export class LlmRefusal extends LlmError {
  constructor(stage: string, details: unknown) {
    const d = details as { category?: string | null; explanation?: string | null } | null;
    super("LLM_REFUSAL", `the model declined the ${stage} request${d?.category ? ` (category: ${d.category})` : ""}${d?.explanation ? `: ${d.explanation}` : ""}. Nothing was changed.`);
  }
}
export class LlmTruncated extends LlmError {
  constructor(stage: string) {
    super("LLM_TRUNCATED", `the model's ${stage} output hit the token limit and is incomplete. Nothing was changed.`);
  }
}
export class LlmSchemaError extends LlmError {
  constructor(stage: string, detail: string) {
    super("LLM_SCHEMA_ERROR", `the model's ${stage} output did not match the expected schema: ${detail}`);
  }
}
export class LlmReplayMiss extends LlmError {
  constructor(stage: string, requestHash: string, file: string) {
    super("LLM_REPLAY_MISS", `no recording for stage "${stage}" with request hash ${requestHash.slice(0, 16)} (expected ${file}). Replay mode never calls the network: re-record with BLINK_LLM_MODE=record.`);
  }
}
export class LlmApiError extends LlmError {
  constructor(stage: string, message: string, retryable: boolean) {
    super("LLM_API_ERROR", `the ${stage} request failed: ${message}`, retryable);
  }
}

// ── Recordings ──────────────────────────────────────────────────────────────

interface Recording {
  stage: string;
  request_hash: string;
  model: string;
  prompt_version: string;
  recorded_at: string;
  latency_ms: number;
  request: { system: string; user: string; effort: string; max_tokens: number };
  response: { id: string | null; model: string; stop_reason: string | null; usage: LlmUsage; parsed_output: unknown };
}

export function recordingFile(stage: string, requestHash: string): string {
  return join(RECORDINGS_DIR(), `${stage}-${requestHash.slice(0, 16)}.json`);
}

export interface StructuredCallOptions<T extends z.ZodType> {
  /** Also the schema name, and the prefix of the recording file. */
  stage: string;
  promptVersion: string;
  schema: T;
  system: string;
  user: string;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** What this call was for, stored with the log row: { caseId?, policyVersionId?, documentId? }. */
  ref?: Record<string, string>;
}

export interface StructuredCallResult<T> {
  data: T;
  callId: string;
  replayed: boolean;
  recordedAt: string | null;
  requestHash: string;
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic()); // ANTHROPIC_API_KEY or an `ant auth login` profile

export function requestHashFor(opts: Pick<StructuredCallOptions<z.ZodType>, "stage" | "promptVersion" | "system" | "user" | "effort" | "maxTokens">): string {
  return hashOf({ model: llmModel(), prompt_version: opts.promptVersion, system: opts.system, user: opts.user, effort: opts.effort, max_tokens: opts.maxTokens ?? 32000, schema: opts.stage });
}

export async function structuredCall<T extends z.ZodType>(opts: StructuredCallOptions<T>): Promise<StructuredCallResult<z.infer<T>>> {
  const mode = llmMode();
  const model = llmModel();
  const maxTokens = opts.maxTokens ?? 32000;
  const requestHash = requestHashFor(opts);
  const file = recordingFile(opts.stage, requestHash);
  const requestSummary = { system: opts.system, user: opts.user, effort: opts.effort, max_tokens: maxTokens };

  const validate = (raw: unknown): z.infer<T> => {
    // Never trust the output blindly, recorded or live.
    const parsed = opts.schema.safeParse(raw);
    if (!parsed.success) throw new LlmSchemaError(opts.stage, parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return parsed.data;
  };
  const log = (response: Recording["response"], latencyMs: number, replayed: boolean, recordedAt: string | null): string => {
    const id = newId("llm");
    getDb()
      .insert(llmCalls)
      .values({
        id,
        stage: opts.stage,
        requestHash,
        model,
        promptVersion: opts.promptVersion,
        requestJson: toJson(requestSummary),
        responseJson: toJson({ id: response.id, served_model: response.model, stop_reason: response.stop_reason, parsed_output: response.parsed_output }),
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens,
        cacheCreationTokens: response.usage.cache_creation_input_tokens,
        stopReason: response.stop_reason,
        latencyMs,
        replayed,
        recordedAt,
        refJson: toJson(opts.ref ?? {}),
        createdAt: nowIso(),
      })
      .run();
    return id;
  };

  // Record mode fills in what is missing: a request that already has a recording is served from it, so an
  // interrupted recording run resumes without paying twice. Set BLINK_LLM_RERECORD=1 to refresh everything.
  const reuseRecording = mode === "record" && existsSync(file) && process.env.BLINK_LLM_RERECORD !== "1";
  if (mode === "replay" || reuseRecording) {
    if (!existsSync(file)) throw new LlmReplayMiss(opts.stage, requestHash, file.replace(`${process.cwd()}/`, ""));
    const recording = JSON.parse(readFileSync(file, "utf8")) as Recording;
    const data = validate(recording.response.parsed_output);
    const callId = log(recording.response, recording.latency_ms, true, recording.recorded_at);
    return { data, callId, replayed: true, recordedAt: recording.recorded_at, requestHash };
  }

  const started = nowMs();
  let message;
  try {
    // Streaming is the single code path: at this max_tokens the SDK refuses a
    // non-streaming request, and long extractions would risk an HTTP timeout.
    const stream = anthropic().beta.messages.stream({
      model,
      max_tokens: maxTokens,
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort, format: betaZodOutputFormat(opts.schema) },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.user }],
      // A safety classifier could decline compliance text about insider trading;
      // the server-side fallback re-runs a declined request on the recommended model (D5).
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    message = await stream.finalMessage();
  } catch (err) {
    if (err instanceof LlmError) throw err;
    // The SDK has already retried 429 and 5xx twice by the time we get here.
    if (err instanceof Anthropic.RateLimitError) throw new LlmApiError(opts.stage, "rate limited (429)", true);
    if (err instanceof Anthropic.APIConnectionError) throw new LlmApiError(opts.stage, `could not reach the API (${err.message})`, true);
    if (err instanceof Anthropic.APIError) throw new LlmApiError(opts.stage, `${err.status ?? "error"} ${err.message}`, (err.status ?? 0) >= 500);
    throw new LlmApiError(opts.stage, err instanceof Error ? err.message : String(err), false);
  }
  const latencyMs = nowMs() - started;

  const usage: LlmUsage = {
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
    cache_read_input_tokens: message.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: message.usage.cache_creation_input_tokens ?? 0,
  };
  const response: Recording["response"] = { id: message.id, model: message.model, stop_reason: message.stop_reason, usage, parsed_output: message.parsed_output ?? null };

  // A refusal or truncation is logged and raised; it is never recorded as a usable response.
  if (message.stop_reason === "refusal") {
    log(response, latencyMs, false, null);
    throw new LlmRefusal(opts.stage, message.stop_details);
  }
  if (message.stop_reason === "max_tokens") {
    log(response, latencyMs, false, null);
    throw new LlmTruncated(opts.stage);
  }
  if (message.parsed_output === null || message.parsed_output === undefined) {
    log(response, latencyMs, false, null);
    throw new LlmSchemaError(opts.stage, "no parsed output");
  }
  const data = validate(message.parsed_output);
  const recordedAt = nowIso();
  const callId = log(response, latencyMs, false, null);

  if (mode === "record") {
    mkdirSync(RECORDINGS_DIR(), { recursive: true });
    const recording: Recording = { stage: opts.stage, request_hash: requestHash, model, prompt_version: opts.promptVersion, recorded_at: recordedAt, latency_ms: latencyMs, request: requestSummary, response };
    writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
  }
  return { data, callId, replayed: false, recordedAt: null, requestHash };
}
