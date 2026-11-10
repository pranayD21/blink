/** Transcript versions (§10.1): parse, store turns, and record lineage against the previous version. */
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { sha256Hex, turnHash } from "@/core/deps/hash";
import { type LineageRow, diffTurns } from "@/core/evidence/lineage";
import { type ParsedTranscript, TranscriptParseError, parseTranscript } from "@/core/transcript/parse";
import { requireCaseAccess } from "../auth/access";
import { type Actor, requireRole } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import type { DbOrTx } from "../db/client";
import { transcriptVersions, turnLineage, turns } from "../db/schema";
import { badRequest, conflict } from "../errors";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { applyCaseEvent } from "./caseStatus";
import { type TranscriptRow, type TurnRow, currentTranscript, turnsOfVersion } from "./loaders";

export const UploadTranscriptSchema = z.strictObject({
  text: z.string().min(1, "the transcript is empty"),
  filename: z.string().nullable().optional(),
  sourceLabel: z.string().trim().min(1).optional(),
  speakerMap: z.record(z.string(), z.enum(["analyst", "expert", "moderator"])).optional(),
  /** "gold" loads hand-labeled claims instead of calling the model (dev only; labeled in the UI). */
  source: z.enum(["ai", "gold"]).default("ai"),
});
export type UploadTranscriptInput = z.infer<typeof UploadTranscriptSchema>;

export function previewTranscript(text: string, filename?: string | null, speakerMap?: Record<string, "analyst" | "expert" | "moderator">): ParsedTranscript {
  try {
    return parseTranscript(text, { filename, speakerMap });
  } catch (err) {
    if (err instanceof TranscriptParseError) throw badRequest(err.message);
    throw err;
  }
}

/** Lineage of a version against the one it supersedes, in turn labels. A first version has none. */
export function lineageOfVersion(tx: DbOrTx, version: TranscriptRow): LineageRow[] {
  const rows = tx.select().from(turnLineage).where(eq(turnLineage.transcriptVersionId, version.id)).all();
  if (rows.length === 0) return [];
  const newTurns = new Map(turnsOfVersion(tx, version.id).map((t) => [t.id, t.label]));
  const oldTurns = version.supersedesId ? new Map(turnsOfVersion(tx, version.supersedesId).map((t) => [t.id, t.label])) : new Map<string, string>();
  return rows.map((r) => ({ oldLabel: r.oldTurnId ? (oldTurns.get(r.oldTurnId) ?? null) : null, newLabel: r.newTurnId ? (newTurns.get(r.newTurnId) ?? null) : null, change: r.change }));
}

export interface UploadResult {
  transcriptVersionId: string;
  versionNo: number;
  jobId: string;
  turnCount: number;
  unknownSpeakers: string[];
  changes: { edited: string[]; added: string[]; removed: string[] };
}

export function uploadTranscript(tx: DbOrTx, caseId: string, input: UploadTranscriptInput, actor: Actor): UploadResult {
  requireRole(actor, "analyst", "reviewer", "senior_reviewer");
  const caseRow = requireCaseAccess(tx, actor, caseId);
  const parsed = previewTranscript(input.text, input.filename, input.speakerMap);
  if (!parsed.turns.some((t) => t.speaker === "expert")) {
    throw badRequest("no expert turns were found. Map the speaker labels to roles and upload again.", { unknownSpeakers: parsed.unknownSpeakers });
  }

  const contentHash = sha256Hex(parsed.rawText);
  const previous = currentTranscript(tx, caseId);
  if (previous?.contentHash === contentHash) {
    throw conflict(`this text is identical to transcript v${previous.versionNo}; nothing to re-analyze`, "TRANSCRIPT_UNCHANGED");
  }

  const versionNo = (tx.select({ n: transcriptVersions.versionNo }).from(transcriptVersions).where(eq(transcriptVersions.caseId, caseId)).orderBy(desc(transcriptVersions.versionNo)).limit(1).get()?.n ?? 0) + 1;
  const versionId = newId("tv");
  tx.insert(transcriptVersions)
    .values({ id: versionId, caseId, versionNo, sourceLabel: input.sourceLabel ?? input.filename ?? `transcript v${versionNo}`, rawText: parsed.rawText, contentHash, supersedesId: previous?.id ?? null, createdBy: actor.id, createdAt: nowIso() })
    .run();

  const newRows: TurnRow[] = parsed.turns.map((t) => ({
    id: `${versionId}:${t.label}`,
    transcriptVersionId: versionId,
    idx: t.idx,
    label: t.label,
    speaker: t.speaker,
    speakerName: t.speakerName,
    timestamp: t.timestamp,
    startChar: t.startChar,
    endChar: t.endChar,
    text: t.text,
    textHash: turnHash(t.text),
  }));
  for (const row of newRows) tx.insert(turns).values(row).run();

  const changes = { edited: [] as string[], added: [] as string[], removed: [] as string[] };
  if (previous) {
    const oldRows = turnsOfVersion(tx, previous.id);
    const oldByLabel = new Map(oldRows.map((t) => [t.label, t]));
    const newByLabel = new Map(newRows.map((t) => [t.label, t]));
    const lineage = diffTurns(oldRows.map((t) => ({ label: t.label, speaker: t.speaker, text: t.text, textHash: t.textHash })), newRows.map((t) => ({ label: t.label, speaker: t.speaker, text: t.text, textHash: t.textHash })));
    for (const row of lineage) {
      tx.insert(turnLineage)
        .values({ id: newId("tl"), transcriptVersionId: versionId, newTurnId: row.newLabel ? newByLabel.get(row.newLabel)!.id : null, oldTurnId: row.oldLabel ? oldByLabel.get(row.oldLabel)!.id : null, change: row.change })
        .run();
      if (row.change === "edited") changes.edited.push(row.newLabel!);
      if (row.change === "added") changes.added.push(row.newLabel!);
      if (row.change === "removed") changes.removed.push(row.oldLabel!);
    }
  }

  appendAudit(tx, {
    actorId: actor.id,
    type: "TRANSCRIPT_UPLOADED",
    entityType: "transcript_version",
    entityId: versionId,
    caseId,
    payload: { version: versionNo, source_label: input.sourceLabel ?? input.filename ?? null, format: parsed.format, turns: parsed.turns.length, content_hash: contentHash, supersedes: previous?.id ?? null, changes },
  });
  applyCaseEvent(tx, caseRow, "ANALYSIS_STARTED", { actorId: actor.id, cause: `transcript v${versionNo} uploaded` });

  const job = enqueueJob(tx, "analyze_transcript", { caseId, transcriptVersionId: versionId, source: input.source, requestedBy: actor.id }, { idempotencyKey: `analyze:${versionId}` });
  return { transcriptVersionId: versionId, versionNo, jobId: job.id, turnCount: parsed.turns.length, unknownSpeakers: parsed.unknownSpeakers, changes };
}

/** Re-runs analysis on the current transcript version as a new run (POST /api/cases/:id/analyze). */
export function requestReanalysis(tx: DbOrTx, caseId: string, actor: Actor, source: "ai" | "gold" = "ai"): { jobId: string } {
  requireRole(actor, "reviewer", "senior_reviewer");
  const caseRow = requireCaseAccess(tx, actor, caseId);
  const transcript = currentTranscript(tx, caseId);
  if (!transcript) throw badRequest("upload a transcript first");
  applyCaseEvent(tx, caseRow, "ANALYSIS_STARTED", { actorId: actor.id, cause: "analysis re-run requested" });
  const job = enqueueJob(tx, "analyze_transcript", { caseId, transcriptVersionId: transcript.id, source, requestedBy: actor.id, rerun: newId("rerun") });
  appendAudit(tx, { actorId: actor.id, type: "ANALYSIS_REQUESTED", entityType: "case", entityId: caseId, caseId, payload: { transcript_version: transcript.versionNo, job: job.id } });
  return { jobId: job.id };
}
