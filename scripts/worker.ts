/**
 * The worker process (§3.3): polls the jobs table every 500 ms and runs one
 * job at a time, writing stage progress the UI polls.
 */
import { closeDb } from "../src/server/db/client";
import { loadEnv } from "../src/server/env";
import { requeueOrphanedJobs } from "../src/server/jobs/queue";
import { runNextJob } from "../src/server/jobs/runner";
import { llmMode, llmModel } from "../src/server/llm/client";

const POLL_MS = 500;
let stopping = false;

async function main() {
  loadEnv();
  const requeued = requeueOrphanedJobs();
  console.log(`[worker] started · LLM mode: ${llmMode()} · model: ${llmModel()}${requeued > 0 ? ` · requeued ${requeued} interrupted job(s)` : ""}`);
  while (!stopping) {
    let ran = false;
    try {
      ran = await runNextJob();
    } catch (err) {
      // e.g. the database is being reset; keep polling.
      console.error("[worker] poll failed:", err instanceof Error ? err.message : err);
    }
    if (!ran) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  closeDb();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
