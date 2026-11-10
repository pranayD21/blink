/**
 * Plays the scripted Halvorsen call through the live path, in a scratch database, with the real
 * live reader: the same turns, in the same order, that `/desktop?source=script` sends.
 *
 *   BLINK_LLM_MODE=record tsx scripts/record-live.ts    record what is missing (calls the API)
 *   BLINK_LLM_MODE=replay tsx scripts/record-live.ts    prove the recordings replay offline
 *
 * The reader's requests depend only on the turns and on what was read before them, never on
 * times or ids, so the browser's scripted call replays from the recordings made here.
 * Exits 1 unless the pill is red at T11, every turn was read live, and the after-call read ran.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { loadActor } from "../src/server/auth/actor";
import { closeDb, getDb, migrateDb, transact } from "../src/server/db/client";
import { jobs, llmCalls } from "../src/server/db/schema";
import { loadEnv } from "../src/server/env";
import { drainJobs } from "../src/server/jobs/runner";
import { costUsd, llmMode } from "../src/server/llm/client";
import { LIVE_MODEL } from "../src/server/live/reader";
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

    const levels = new Map<string, string>();
    const notRead: string[] = [];
    for (const turn of halvorsenLiveTurns()) {
      const label = `T${turn.seq}`;
      const decision = await ingestTurn(call.id, { ...turn, speechEndedAt: iso(turn.speechEndMs), transcribedAt: iso(turn.speechEndMs + 200) }, priya);
      levels.set(label, decision.pill.level);
      if (decision.readStatus !== "read") notRead.push(`${label} (${decision.readStatus})`);
      console.log(`   ${label.padEnd(4)} ${turn.speaker.padEnd(7)} pill ${decision.pill.level.padEnd(9)} read ${decision.readStatus}`);
    }
    await turnsSettled(call.id);

    const ended = transact((tx) => endCall(tx, call.id, priya));
    console.log(`   ${ended.pillText}`);
    await drainJobs();
    for (const job of failedJobs()) console.log(`   ! job ${job.type} failed: ${job.error}`);

    check(levels.get(RED_AT) === "red", `the pill is red at ${RED_AT} (it is ${levels.get(RED_AT) ?? "missing"})`);
    check(notRead.length === 0, `every turn was read live${notRead.length ? `; not read: ${notRead.join(", ")}` : ""}`);
    check(failedJobs().length === 0, "the after-call read ran");
    finish();
  } finally {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  }
}

function finish() {
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
  if (problems.length === 0) console.log("   All checks passed.");
  else console.log(`   ${problems.length} check(s) failed.`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
