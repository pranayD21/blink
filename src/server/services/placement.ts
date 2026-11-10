/**
 * Placing a passage recorded on one transcript version onto the case's current version.
 *
 * A quote or a live passage is stored against the turn row it was found on. Carried and revised claims
 * are re-pointed at each new version, but a retired claim and a live finding's passages stay on the
 * version they were recorded on. Turn labels are not stable across versions (an inserted turn shifts
 * every later label), so a passage is mapped through the same turn lineage the re-analysis uses
 * (`diffTurns`, as `persistAnalysis` does), never by label alone.
 */
import { inArray } from "drizzle-orm";
import { type LineageRow, diffTurns } from "@/core/evidence/lineage";
import type { DbOrTx } from "../db/client";
import { turns } from "../db/schema";
import { type TranscriptRow, type TurnRow, currentTranscript, turnsOfVersion } from "./loaders";

export interface Placed {
  turn: TurnRow;
  start: number;
  end: number;
}

export interface TurnPlacer {
  transcript: TranscriptRow | null;
  current: TurnRow[];
  /**
   * Where a passage stands on the current transcript. The same turn text keeps the offsets; a turn whose
   * text changed is hidden whole; null when the turn row is gone or the turn was removed.
   */
  place(turnId: string, start: number, end: number): Placed | null;
  /** The current label of the turn a passage was recorded on, or null when it cannot be placed. */
  currentLabel(turnId: string): string | null;
  /** The label the passage's turn had where it was recorded ("T5"), for naming it. */
  sourceLabel(turnId: string): string;
}

const lineageTurn = (t: TurnRow) => ({ label: t.label, speaker: t.speaker, text: t.text, textHash: t.textHash });

export function turnPlacer(tx: DbOrTx, caseId: string, preload: readonly string[] = []): TurnPlacer {
  const transcript = currentTranscript(tx, caseId);
  const current = transcript ? turnsOfVersion(tx, transcript.id) : [];
  const currentById = new Map(current.map((t) => [t.id, t]));
  const currentByLabel = new Map(current.map((t) => [t.label, t]));

  const sources = new Map<string, TurnRow | null>();
  const load = (ids: readonly string[]) => {
    const missing = [...new Set(ids)].filter((id) => !sources.has(id) && !currentById.has(id));
    if (missing.length === 0) return;
    const rows = tx.select().from(turns).where(inArray(turns.id, missing)).all();
    const byId = new Map(rows.map((t) => [t.id, t]));
    for (const id of missing) sources.set(id, byId.get(id) ?? null);
  };
  load(preload);
  const source = (turnId: string): TurnRow | null => {
    const here = currentById.get(turnId);
    if (here) return here;
    load([turnId]);
    return sources.get(turnId) ?? null;
  };

  // Old label → current label, per earlier version.
  const lineages = new Map<string, Map<string, string | null>>();
  const mapped = (src: TurnRow): TurnRow | null => {
    if (currentById.has(src.id)) return src;
    if (!transcript) return null;
    let map = lineages.get(src.transcriptVersionId);
    if (!map) {
      const rows: LineageRow[] = diffTurns(turnsOfVersion(tx, src.transcriptVersionId).map(lineageTurn), current.map(lineageTurn));
      map = new Map(rows.filter((r) => r.oldLabel).map((r) => [r.oldLabel!, r.newLabel]));
      lineages.set(src.transcriptVersionId, map);
    }
    const label = map.get(src.label);
    return label ? (currentByLabel.get(label) ?? null) : null;
  };

  return {
    transcript,
    current,
    place(turnId, start, end) {
      const src = source(turnId);
      const turn = src ? mapped(src) : null;
      if (!src || !turn) return null;
      if (turn.textHash === src.textHash) return { turn, start, end };
      return { turn, start: 0, end: turn.text.length };
    },
    currentLabel(turnId) {
      const src = source(turnId);
      return src ? (mapped(src)?.label ?? null) : null;
    },
    sourceLabel(turnId) {
      return source(turnId)?.label ?? turnId.slice(turnId.lastIndexOf(":") + 1);
    },
  };
}
