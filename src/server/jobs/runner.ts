/**
 * Runs jobs from the queue. Shared by the worker process, the seed script,
 * and tests, so all three exercise the same handlers.
 */
import { LlmError } from "../llm/client";
import { analyzeTranscript, analyzeTranscriptFailed } from "./handlers/analyzeTranscript";
import { compilePolicy, compilePolicyFailed } from "./handlers/compilePolicy";
import { draftBrief } from "./handlers/draftBrief";
import { extractDocFacts, extractDocFactsFailed } from "./handlers/extractDocFacts";
import { reevaluateCaseJob } from "./handlers/reevaluateCase";
import { type JobRow, type JobType, claimNextJob, completeJob, failJob } from "./queue";

interface Handler {
  run(job: JobRow): Promise<Record<string, unknown>>;
  /** Called once, when the job fails for good. */
  onFailed?(job: JobRow, error: unknown): void;
}

const HANDLERS: Record<JobType, Handler> = {
  compile_policy: { run: compilePolicy, onFailed: compilePolicyFailed },
  analyze_transcript: { run: analyzeTranscript, onFailed: analyzeTranscriptFailed },
  reevaluate_case: { run: reevaluateCaseJob },
  draft_brief: { run: draftBrief },
  extract_doc_facts: { run: extractDocFacts, onFailed: extractDocFactsFailed },
};

export async function processJob(job: JobRow): Promise<"succeeded" | "requeued" | "failed"> {
  const handler = HANDLERS[job.type];
  try {
    completeJob(job.id, await handler.run(job));
    return "succeeded";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Only transient API errors are worth another attempt; everything else would fail the same way.
    const outcome = failJob(job.id, message, { retry: error instanceof LlmError && error.retryable });
    if (outcome === "failed") {
      try {
        handler.onFailed?.(job, error);
      } catch (hookError) {
        console.error(`[jobs] failure hook for ${job.type} ${job.id} threw:`, hookError);
      }
    }
    return outcome;
  }
}

/** Takes and runs one job. Returns false when the queue is empty. */
export async function runNextJob(): Promise<boolean> {
  const job = claimNextJob();
  if (!job) return false;
  await processJob(job);
  return true;
}

/** Runs jobs until none are queued. */
export async function drainJobs(limit = 100): Promise<number> {
  let n = 0;
  while (n < limit && (await runNextJob())) n++;
  return n;
}
