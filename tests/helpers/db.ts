/**
 * Drives the services against an in-memory database, the way the routes do.
 * No network: claims come from the hand-labeled fixtures and briefs from the
 * template drafter, so every test is deterministic.
 */
import { and, eq } from "drizzle-orm";
import { groundExtraction } from "@/core/extraction/ground";
import { LlmExtractionSchema } from "@/core/extraction/schema";
import type { DispositionOutcome } from "@/core/types";
import { type Actor, loadActor } from "@/server/auth/actor";
import { getDb, resetDbForTests, transact } from "@/server/db/client";
import { findings, jobs, tasks } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { drainJobs } from "@/server/jobs/runner";
import { persistAnalysis, startRun } from "@/server/services/analysis";
import { attestCase } from "@/server/services/attestations";
import { type BriefRow, approveBrief, getBrief, requestBriefDraft } from "@/server/services/briefs";
import { createCase } from "@/server/services/cases";
import { answerTask, applyFindingAction, getFinding } from "@/server/services/findings";
import type { FindingRow, TaskRow } from "@/server/services/findingsCore";
import { currentTranscript, getCase, turnsOfVersion } from "@/server/services/loaders";
import { type ReleaseResult, releaseBrief } from "@/server/services/release";
import { HALVORSEN_CASE_ID, halvorsenCaseInput, readFixtureText, seedDatabase } from "@/server/services/seed";
import { uploadTranscript } from "@/server/services/transcripts";

export const CASE = HALVORSEN_CASE_ID;
export const RATIONALE = "Reviewed the linked passages against the policy and the public record.";

/** The claim keys of the three gold findings in the hand-labeled Halvorsen extraction. */
export const G1 = "C1"; // T5 + T11, Q3 West region bookings from the dashboard
export const G2 = "C7"; // T15, the Cardinal Utilities contract
export const G3 = "C8"; // T17, margins "well before I left"
export const STEEL = "C9"; // T19, the statement transcript v2 corrects

export type Who = "priya" | "marcus" | "jordan" | "dana";
export const user = (who: Who): Actor => loadActor(getDb(), `user_${who}`);

/** A fresh database with users, documents, and the Halvorsen case; nothing compiled or analyzed. */
export async function seedEmpty(): Promise<void> {
  resetDbForTests();
  await seedDatabase({ enqueueDocFacts: false, goldDocFacts: true });
}

/** The Halvorsen case analyzed from hand-labeled claims under the manual fallback policy. */
export async function seedAnalyzed(): Promise<string> {
  resetDbForTests();
  await seedDatabase({ manualPolicy: true, gold: true });
  return CASE;
}

export function findingOn(claimKey: string, origin: FindingRow["origin"] = "policy", caseId = CASE): FindingRow {
  const row = getDb().select().from(findings).where(and(eq(findings.caseId, caseId), eq(findings.claimLogicalKey, claimKey), eq(findings.origin, origin))).get();
  if (!row) throw new Error(`no ${origin} finding on ${claimKey}`);
  return row;
}

export const findingsOf = (caseId = CASE): FindingRow[] => getDb().select().from(findings).where(eq(findings.caseId, caseId)).all();
export const tasksOf = (findingId: string): TaskRow[] => getDb().select().from(tasks).where(eq(tasks.findingId, findingId)).all();
export const openTasks = (findingId: string, kind?: TaskRow["kind"]) => tasksOf(findingId).filter((t) => t.status === "open" && (!kind || t.kind === kind));
export const statusOf = (caseId = CASE) => getCase(getDb(), caseId).status;

export function dispose(findingId: string, outcome: DispositionOutcome, who: Who, rationale = RATIONALE) {
  return transact((tx) => applyFindingAction(tx, findingId, { type: "DISPOSE", outcome, rationale, expectedVersion: getFinding(tx, findingId).version }, user(who)));
}

export function escalate(findingId: string, who: Who, rationale = RATIONALE) {
  return transact((tx) => applyFindingAction(tx, findingId, { type: "ESCALATE", rationale, expectedVersion: getFinding(tx, findingId).version }, user(who)));
}

/** The demo's clarification for the margin statement: the expert confirms it was public commentary. */
export function answerMarginClarification(who: Who = "marcus") {
  const finding = findingOn(G3);
  const task = openTasks(finding.id, "context")[0];
  if (!task) throw new Error("the margin finding has no open context task");
  return transact((tx) =>
    answerTask(tx, task.id, { answer: "Expert confirms it reflects Halvorsen's public Q1 earnings-call commentary.", fieldMapping: { knowledge_basis: "public_source" }, expectedVersion: task.version }, user(who)),
  );
}

export function attest(who: Who = "marcus", caseId = CASE) {
  return transact((tx) => attestCase(tx, caseId, { transcriptVersionId: currentTranscript(tx, caseId)!.id }, user(who)));
}

/** Step 6 of the demo: decide every finding, then attest. The case ends READY_FOR_APPROVAL. */
export function completeReview(): void {
  answerMarginClarification();
  dispose(findingOn(G3).id, "no_concern", "marcus");
  dispose(findingOn(G2).id, "restricted_exclude", "marcus");
  dispose(findingOn(G1).id, "restricted_escalate_to_legal", "jordan");
  for (const f of findingsOf().filter((f) => f.origin === "ai_suggested" && f.state !== "DISPOSITIONED")) dispose(f.id, "no_concern", "marcus");
  attest();
}

export function draftTemplate(who: Who = "marcus", caseId = CASE): BriefRow {
  const { briefId } = transact((tx) => requestBriefDraft(tx, caseId, "template", user(who)));
  return getBrief(getDb(), briefId!);
}

export function approve(briefId: string, audience: "analyst" | "investment_team" = "analyst", who: Who = "marcus") {
  return transact((tx) => {
    const brief = getBrief(tx, briefId);
    return approveBrief(tx, briefId, { briefHash: brief.contentHash, audience, expectedVersion: brief.version }, user(who));
  });
}

export function release(briefId: string, audience: "analyst" | "investment_team" = "analyst", who: Who = "marcus"): ReleaseResult {
  return transact((tx) => releaseBrief(tx, briefId, { audience, expectedVersion: getBrief(tx, briefId).version }, user(who)));
}

/** Review, draft, approve: everything up to the moment before release. */
export function reviewAndApprove(): BriefRow {
  completeReview();
  const brief = draftTemplate();
  approve(brief.id);
  return getBrief(getDb(), brief.id);
}

/** Uploads the network's corrected transcript (T19: twelve → twenty-one percent) and re-analyzes. */
export async function uploadV2(who: Who = "priya"): Promise<void> {
  transact((tx) => uploadTranscript(tx, CASE, { text: readFixtureText("cases", "halvorsen", "transcript-v2.txt"), filename: "transcript-v2.txt", sourceLabel: "Meridian transcript v2 (corrected)", source: "gold" }, user(who)));
  await drainJobs();
}

/**
 * Creates a case from a short fixture transcript and runs the deterministic
 * half of analysis on hand-labeled claims: grounding → persistence →
 * comparison → policy evaluation.
 */
export function analyzeFixtureCase(id: string, transcript: string, extraction: unknown): string {
  const caseId = `case_${id.toLowerCase()}`;
  transact((tx) => createCase(tx, { ...halvorsenCaseInput(), title: `Fixture ${id}` }, user("priya"), { id: caseId }));
  const upload = transact((tx) => uploadTranscript(tx, caseId, { text: transcript, filename: `${id}.txt`, source: "gold" }, user("priya")));
  // The queued job would look for Halvorsen's gold file; run the same stages here with this fixture's claims.
  getDb().delete(jobs).where(eq(jobs.id, upload.jobId)).run();
  transact((tx) => {
    const version = currentTranscript(tx, caseId)!;
    const turns = turnsOfVersion(tx, version.id).map((t) => ({ label: t.label, idx: t.idx, speaker: t.speaker, text: t.text, textHash: t.textHash }));
    const grounding = groundExtraction(LlmExtractionSchema.parse(extraction), turns);
    const run = startRun(tx, { caseId, transcript: version, model: "none (hand-labeled)", promptVersion: "gold", source: "gold" });
    persistAnalysis(tx, { caseId, runId: run.id, transcript: version, grounding, llmCallId: null });
  });
  return caseId;
}

/** Runs `fn` and returns the AppError it throws; fails the test if it does not throw one. */
export function appError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err;
    throw err;
  }
  throw new Error("expected an AppError, but nothing was thrown");
}
