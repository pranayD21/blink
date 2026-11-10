/**
 * Plays the scripted Halvorsen call through the live path, in a scratch database, with the real
 * live reader: the same turns, in the same order, that `/desktop?source=script` sends.
 *
 *   BLINK_LLM_MODE=record tsx scripts/record-live.ts    record what is missing (calls the API)
 *   BLINK_LLM_MODE=replay tsx scripts/record-live.ts    prove the recordings replay offline
 *
 * The reader's requests depend only on the turns and on what was read before them, never on
 * times or ids, so the browser's scripted call replays from the recordings made here.
 * Exits 1 unless the pill is red at T11, every turn has a recorded read, and the after-call read ran.
 * Replay does not apply the live time limit, so it also says which reads took longer than that
 * limit when they were recorded: those turns would not have been read live.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import { loadActor } from "../src/server/auth/actor";
import { closeDb, getDb, migrateDb, transact } from "../src/server/db/client";
import { callTurns, jobs, llmCalls } from "../src/server/db/schema";
import { loadEnv } from "../src/server/env";
import { drainJobs } from "../src/server/jobs/runner";
import { costUsd, llmMode } from "../src/server/llm/client";
import { LIVE_MODEL, READ_TIMEOUT_MS } from "../src/server/live/reader";
import { endCall, ingestTurn, startCall, turnsSettled } from "../src/server/services/live";
import { HALVORSEN_CASE_ID, halvorsenLiveTurns, seedDatabase } from "../src/server/services/seed";

/** The source remark: the expert says where the T5 figure came from. */
const RED_AT = "T11";

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`   ${ok ? "✓" : "✗"} ${message}`);
  if (!ok) problems.push(message);
};

const failedJobs = () => getDb().select().from(jobs).where(eq(jobs.status, "failed")).all();

async function main() {
  loadEnv();
  const dir = mkdtempSync(join(tmpdir(), "blink-live-"));
  process.env.BLINK_DB_PATH = join(dir, "live.db");
  migrateDb();
  console.log(`Scripted call · LLM mode: ${llmMode()} · live reader: ${LIVE_MODEL()} · database: ${process.env.BLINK_DB_PATH}`);

  try {
    // The live e2e server's starting point: the manual policy, document facts extracted, Halvorsen at intake.
    await seedDatabase({ manualPolicy: true });
    await drainJobs();
    check(failedJobs().length === 0, "seed: document facts extracted");

    const priya = loadActor(getDb(), "user_priya");
    const call = transact((tx) => startCall(tx, { caseId: HALVORSEN_CASE_ID }, priya));
    const origin = Date.now();
    const iso = (ms: number) => new Date(origin + ms).toISOString();

    let unread = 0;
    const levels = new Map<string, string>();
    const notRead: string[] = [];
    for (const turn of halvorsenLiveTurns()) {
      const label = `T${turn.seq}`;
      const decision = await ingestTurn(call.id, { ...turn, speechEndedAt: iso(turn.speechEndMs), transcribedAt: iso(turn.speechEndMs + 200) }, priya);
      levels.set(label, decision.pill.level);
      if (decision.readStatus !== "read") {
        notRead.push(`${label} (${decision.readStatus})`);
        // A refusal is logged with its usage; a timeout or a failure leaves none behind.
        if (decision.readStatus !== "refused") unread++;
      }
      console.log(`   ${label.padEnd(4)} ${turn.speaker.padEnd(7)} pill ${decision.pill.level.padEnd(9)} read ${decision.readStatus}`);
    }
    await turnsSettled(call.id);

    const ended = transact((tx) => endCall(tx, call.id, priya));
    console.log(`   ${ended.pillText}`);
    await drainJobs();
    for (const job of failedJobs()) console.log(`   ! job ${job.type} failed: ${job.error}`);

    check(levels.get(RED_AT) === "red", `the pill is red at ${RED_AT} (it is ${levels.get(RED_AT) ?? "missing"})`);
    check(notRead.length === 0, `every turn has a recorded read (replay does not apply the live time limit)${notRead.length ? `; not read: ${notRead.join(", ")}` : ""}`);
    reportSlowReads(call.id);
    check(failedJobs().length === 0, "the after-call read ran");
    finish(unread);
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The reads that took longer than the live limit when they were recorded. Reported, never failed: replay serves them anyway. */
function reportSlowReads(callId: string) {
  const turns = getDb().select().from(callTurns).where(eq(callTurns.callId, callId)).orderBy(asc(callTurns.seq)).all();
  const latency = new Map(getDb().select({ id: llmCalls.id, latencyMs: llmCalls.latencyMs }).from(llmCalls).all().map((c) => [c.id, c.latencyMs]));
  const slow = turns
    .map((t) => ({ label: `T${t.seq}`, ms: t.llmCallId ? latency.get(t.llmCallId) : undefined }))
    .filter((t): t is { label: string; ms: number } => t.ms !== undefined && t.ms > READ_TIMEOUT_MS);
  const limit = `${READ_TIMEOUT_MS / 1000} s`;
  const list = slow.map((t) => `${t.label} (${(t.ms / 1000).toFixed(1)} s)`).join(", ");
  console.log(`   ${slow.length} of ${turns.length} reads took longer than the ${limit} live limit when recorded${slow.length ? `: ${list}` : ""}`);
}

function finish(unread: number) {
  const calls = getDb().select().from(llmCalls).all();
  const live = calls.filter((c) => !c.replayed);
  let usd = 0;
  let unpriced = 0;
  for (const c of live) {
    const one = costUsd({ input_tokens: c.inputTokens, output_tokens: c.outputTokens, cache_read_input_tokens: c.cacheReadTokens, cache_creation_input_tokens: c.cacheCreationTokens }, c.model);
    if (one === null) unpriced++;
    else usd += one;
  }
  const byStage = (rows: typeof calls) => [...new Set(rows.map((c) => c.stage))].map((s) => `${s} ${rows.filter((c) => c.stage === s).length}`).join(", ") || "none";
  console.log(`   ${calls.length} model call(s): ${live.length} live (${byStage(live)}; $${usd.toFixed(3)}${unpriced ? ` + ${unpriced} with no listed price` : ""}), ${calls.length - live.length} replayed`);
  // A read that timed out or failed leaves no usage behind, so its cost is unknown, never zero.
  if (unread > 0) console.log(`   ${unread} read(s) with unknown cost: they timed out or failed before any usage came back, so they are not in the total`);
  if (problems.length === 0) console.log("   All checks passed.");
  else console.log(`   ${problems.length} check(s) failed.`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
