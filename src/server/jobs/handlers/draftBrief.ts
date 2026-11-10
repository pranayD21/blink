/** Job `draft_brief` (§12.6): the model sees only eligible claims; code then enforces citations. */
import { LlmBriefSchema } from "@/core/extraction/schema";
import { fromJson, getDb, transact } from "../../db/client";
import { structuredCall } from "../../llm/client";
import { BRIEF_PROMPT_VERSION, BRIEF_STAGE, BRIEF_SYSTEM, buildBriefUser } from "../../llm/prompts/brief";
import { eligibilityForCase, saveBriefDraft } from "../../services/briefs";
import { loadCaseBundle } from "../../services/loaders";
import { type JobRow, setJobStage } from "../queue";

export async function draftBrief(job: JobRow): Promise<Record<string, unknown>> {
  const { caseId, requestedBy } = fromJson<{ caseId: string; requestedBy?: string }>(job.payloadJson, { caseId: "" });
  const db = getDb();
  setJobStage(job.id, "Selecting eligible claims", 10);
  const bundle = loadCaseBundle(db, caseId);
  // Restricted and undecided claims never reach the prompt.
  const { eligible } = eligibilityForCase(db, caseId);

  setJobStage(job.id, "Drafting brief", 35);
  const result = await structuredCall({
    stage: BRIEF_STAGE,
    promptVersion: BRIEF_PROMPT_VERSION,
    schema: LlmBriefSchema,
    system: BRIEF_SYSTEM,
    user: buildBriefUser({
      caseTitle: bundle.caseRow.title,
      issuer: bundle.caseRow.issuer,
      researchQuestions: bundle.researchQuestions,
      claims: eligible.map((c) => ({ key: c.row.logicalKey, summary: c.fields.summary, quotes: c.quotes.map((q) => ({ turnLabel: q.turnLabel, quote: q.quote })) })),
    }),
    effort: "medium",
    maxTokens: 16000,
    ref: { caseId },
  });

  setJobStage(job.id, "Checking citations", 85);
  const brief = transact((tx) => saveBriefDraft(tx, { caseId, sections: result.data.sections, source: "ai", actorId: requestedBy ?? "system", llmCallId: result.callId }));
  return { briefId: brief.id, versionNo: brief.versionNo, replayed: result.replayed };
}
