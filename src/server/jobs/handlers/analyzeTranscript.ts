/**
 * Job `analyze_transcript` (§10). Stages are written to `jobs.stage` for the
 * progress bar: Parsing · Extracting claims · Validating quotes · Comparing
 * public evidence · Evaluating policy · Done.
 *
 * The model is asked once (stage 2). Everything after it is deterministic.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { type GroundingTurn, groundExtraction } from "@/core/extraction/ground";
import { type LlmExtraction, LlmExtractionSchema, LlmExtractionWireSchema, extractionFromWire } from "@/core/extraction/schema";
import { fromJson, getDb, transact } from "../../db/client";
import { analysisRuns, transcriptVersions } from "../../db/schema";
import { LlmError, LlmSchemaError, llmModel, structuredCall } from "../../llm/client";
import { EXTRACT_PROMPT_VERSION, EXTRACT_STAGE, EXTRACT_SYSTEM, buildExtractUser } from "../../llm/prompts/extract";
import { persistAnalysis, recordAnalysisFailure, recordBlockingIssue, setRunStage, startRun } from "../../services/analysis";
import { reconcileLiveFlags } from "../../services/live";
import { loadCaseBundle, loadDocumentSet, turnsOfVersion } from "../../services/loaders";
import { type JobRow, setJobStage } from "../queue";
import { extractFactsForDocument } from "./extractDocFacts";

interface Payload {
  caseId: string;
  transcriptVersionId: string;
  source?: "ai" | "gold";
}

/**
 * Hand-labeled claims for the seeded Halvorsen case (dev only). When the
 * transcript is the corrected v2, the fixture's patch moves the one claim
 * that quotes the corrected turn.
 */
function goldExtraction(ticker: string, turns: GroundingTurn[]): LlmExtraction {
  if (ticker !== "HLVP") throw new LlmError("GOLD_UNAVAILABLE", "hand-labeled claims exist only for the seeded Halvorsen case");
  const file = JSON.parse(readFileSync(resolve(process.cwd(), "fixtures/cases/halvorsen/gold.json"), "utf8")) as {
    extraction: unknown;
    extraction_v2_patch?: { claim: string; replace: [string, string][]; value_number: number };
  };
  const extraction = LlmExtractionSchema.parse(file.extraction);
  const patch = file.extraction_v2_patch;
  if (patch) {
    const claim = extraction.claims.find((c) => c.logical_key === patch.claim);
    const stillV1 = claim?.quotes.every((q) => turns.find((t) => t.label === q.turn_id)?.text.includes(q.quote));
    if (claim && !stillV1) {
      const swap = (text: string) => patch.replace.reduce((s, [from, to]) => s.replaceAll(from, to), text);
      claim.fields.summary = swap(claim.fields.summary);
      if (claim.fields.value) claim.fields.value.number = patch.value_number;
      for (const q of claim.quotes) q.quote = swap(q.quote);
    }
  }
  return extraction;
}

export async function analyzeTranscript(job: JobRow): Promise<Record<string, unknown>> {
  const payload = fromJson<Payload>(job.payloadJson, {} as Payload);
  const source = payload.source ?? "ai";
  const db = getDb();

  setJobStage(job.id, "Parsing", 5);
  const transcript = db.select().from(transcriptVersions).where(eq(transcriptVersions.id, payload.transcriptVersionId)).get();
  if (!transcript) throw new Error(`transcript version ${payload.transcriptVersionId} not found`);
  const bundle = loadCaseBundle(db, payload.caseId);
  const turnRows = turnsOfVersion(db, transcript.id);
  const turns: GroundingTurn[] = turnRows.map((t) => ({ label: t.label, idx: t.idx, speaker: t.speaker, text: t.text, textHash: t.textHash }));

  const run = transact((tx) => startRun(tx, { caseId: payload.caseId, transcript, model: source === "gold" ? "none (hand-labeled)" : llmModel(), promptVersion: source === "gold" ? "gold" : EXTRACT_PROMPT_VERSION, source }));
  // Remember the run on the job so a terminal failure can be attached to it.
  runByJob.set(job.id, run.id);

  // The comparator needs document facts; extract any that are still pending (recorded, so replay is offline).
  if (source === "ai") {
    const pending = loadDocumentSet(db, bundle.caseRow.documentSetId).rows.filter((d) => d.factsStatus !== "extracted");
    for (const [i, doc] of pending.entries()) {
      setJobStage(job.id, `Reading public documents (${i + 1} of ${pending.length})`, 8 + Math.round((i / pending.length) * 8));
      await extractFactsForDocument(doc.id);
    }
  }

  setJobStage(job.id, "Extracting claims", 20);
  transact((tx) => setRunStage(tx, run.id, "Extracting claims"));
  let extraction: LlmExtraction;
  let llmCallId: string | null = null;
  if (source === "gold") {
    extraction = goldExtraction(bundle.caseRow.ticker, turns);
  } else {
    const result = await structuredCall({
      stage: EXTRACT_STAGE,
      promptVersion: EXTRACT_PROMPT_VERSION,
      schema: LlmExtractionWireSchema,
      system: EXTRACT_SYSTEM,
      user: buildExtractUser({ ctx: bundle.ctx, researchQuestions: bundle.researchQuestions, expert: bundle.expertProfile, turns: turnRows.map((t) => ({ label: t.label, speaker: t.speaker, text: t.text })) }),
      effort: "high",
      maxTokens: 32000,
      ref: { caseId: payload.caseId, runId: run.id },
    });
    // The flat wire form is restored to the canonical shape and checked again before anything uses it.
    const canonical = LlmExtractionSchema.safeParse(extractionFromWire(result.data));
    if (!canonical.success) throw new LlmSchemaError(EXTRACT_STAGE, canonical.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    extraction = canonical.data;
    llmCallId = result.callId;
  }

  setJobStage(job.id, "Validating quotes", 55);
  transact((tx) => setRunStage(tx, run.id, "Validating quotes"));
  const grounding = groundExtraction(extraction, turns);

  setJobStage(job.id, "Comparing public evidence", 70);
  transact((tx) => setRunStage(tx, run.id, "Comparing public evidence"));
  setJobStage(job.id, "Evaluating policy", 85);
  // Persistence, comparison, evaluation, staleness, status change, and keeping what a live call
  // flagged but this read did not are one transaction.
  const report = transact((tx) => {
    const persisted = persistAnalysis(tx, { caseId: payload.caseId, runId: run.id, transcript, grounding, llmCallId });
    reconcileLiveFlags(tx, transcript.id);
    return persisted;
  });
  runByJob.delete(job.id);
  return { runId: run.id, runNo: run.runNo, claims: report.claims, findingsOpened: report.findingsOpened, quotes: report.stats, stale: report.stale };
}

const runByJob = new Map<string, string>();

/** Called when the job fails for good: the failure becomes a visible, blocking processing issue (D5). */
export function analyzeTranscriptFailed(job: JobRow, error: unknown): void {
  const payload = fromJson<Payload>(job.payloadJson, {} as Payload);
  const code = error instanceof LlmError ? error.code : "ANALYSIS_ERROR";
  const message = error instanceof Error ? error.message : String(error);
  const runId = runByJob.get(job.id) ?? getDb().select().from(analysisRuns).where(eq(analysisRuns.caseId, payload.caseId)).all().filter((r) => r.status === "running").at(-1)?.id ?? null;
  runByJob.delete(job.id);
  transact((tx) => recordAnalysisFailure(tx, { caseId: payload.caseId, runId, code, message }));
  // Fail closed: with no after-call read, every passage a live call flagged becomes a finding.
  if (!payload.transcriptVersionId) return;
  try {
    transact((tx) => reconcileLiveFlags(tx, payload.transcriptVersionId));
  } catch (reconcileError) {
    // Live flags that could not be kept must not fail quietly: block the case, then let the runner log it.
    const detail = reconcileError instanceof Error ? reconcileError.message : String(reconcileError);
    transact((tx) => recordBlockingIssue(tx, { caseId: payload.caseId, code: "LIVE_RECONCILE_FAILED", message: `Passages flagged during the live call could not be kept for compliance after the after-call read failed: ${detail}`, ref: { transcriptVersionId: payload.transcriptVersionId } }));
    throw reconcileError;
  }
}
