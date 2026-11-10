/**
 * What a banker reads of a released call: the transcript as it was frozen at release, every passage
 * compliance kept hidden already blanked. The turn text comes only from the release's own snapshot,
 * never from the `turns` table, so no route through here can return unblanked text.
 */
import type { RedactedTurn } from "@/core/release/redact";
import type { Actor } from "../auth/actor";
import { type DbOrTx, fromJson } from "../db/client";
import { notFound } from "../errors";
import { type ReleaseStanding, readableRelease } from "./briefs";

export interface ReleasedTranscript {
  release: { id: string; caseTitle: string; releasedAt: string; standing: ReleaseStanding };
  /** False for a release made before transcripts were frozen: there is nothing to show, and the count means nothing. */
  available: boolean;
  turns: RedactedTurn[];
  hiddenPassages: number;
}

/** GET /api/analyst/releases/:id — a release the actor may not read is a 404, the same as one that does not exist. */
export function releasedTranscript(tx: DbOrTx, releaseId: string, actor: Actor): ReleasedTranscript {
  const found = readableRelease(tx, releaseId, actor);
  if (!found) throw notFound("release");
  const { release, caseRow, standing } = found;
  return {
    release: { id: release.id, caseTitle: caseRow.title, releasedAt: release.releasedAt, standing },
    available: release.redactedTranscriptJson !== null,
    turns: fromJson<RedactedTurn[]>(release.redactedTranscriptJson, []),
    hiddenPassages: release.hiddenPassages ?? 0,
  };
}
