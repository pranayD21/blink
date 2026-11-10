/**
 * Placing a passage recorded on one transcript version onto the case's current version.
 *
 * A quote or a live passage is stored against the turn row it was found on. Carried and revised claims
 * are re-pointed at each new version, but a retired claim and a live finding's passages stay on the
 * version they were recorded on. Turn labels are not stable across versions (an inserted turn shifts
 * every later label), so a passage is followed through the stored `turn_lineage` chain one version at
 * a time, as the staleness pass does. `diffTurns` is only a fallback for a version with no stored lineage.
 *
 * Fail closed when the text changed on the way:
 *  - the turn lineage maps it to is blanked whole;
 *  - so is every turn lineage reports as added directly after it, in the same gap (a split turn);
 *  - and every current turn that contains the hidden words verbatim (whitespace aside) has that run blanked.
 */
import { and, eq, inArray } from "drizzle-orm";
import { diffTurns } from "@/core/evidence/lineage";
import type { DbOrTx } from "../db/client";
import { turnLineage, turns } from "../db/schema";
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
   * Every span on the current transcript a passage must blank, the turn lineage maps it to first.
   * Null when the passage cannot be placed: its turn row is gone or the turn was removed.
   */
  place(turnId: string, start: number, end: number): Placed[] | null;
  /** The label the passage's turn had where it was recorded ("T5"), for naming it. */
  sourceLabel(turnId: string): string;
  /** The words the passage hid where it was recorded, or null when that turn row is gone. */
  sourceText(turnId: string, start: number, end: number): string | null;
}

const lineageTurn = (t: TurnRow) => ({ label: t.label, speaker: t.speaker, text: t.text, textHash: t.textHash });

/** Whitespace runs collapsed to one space, with each kept character's offset in the original. */
function squeeze(text: string): { text: string; at: number[] } {
  let out = "";
  const at: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      space = out.length > 0;
      continue;
    }
    if (space) {
      out += " ";
      at.push(i - 1);
      space = false;
    }
    out += text[i];
    at.push(i);
  }
  return { text: out, at };
}

/** Every run of `turn` that reads `needle` once whitespace is collapsed. */
function verbatim(turn: TurnRow, needle: string): Placed[] {
  const n = squeeze(needle).text;
  if (n.length === 0) return [];
  const hay = squeeze(turn.text);
  const out: Placed[] = [];
  for (let i = hay.text.indexOf(n); i >= 0; i = hay.text.indexOf(n, i + 1)) {
    out.push({ turn, start: hay.at[i], end: hay.at[i + n.length - 1] + 1 });
  }
  return out;
}

const sliceOf = (t: TurnRow, start: number, end: number) => t.text.slice(Math.max(0, Math.min(start, end)), Math.max(start, end));

export function turnPlacer(tx: DbOrTx, caseId: string, preload: readonly string[] = []): TurnPlacer {
  const transcript = currentTranscript(tx, caseId);
  const current = transcript ? turnsOfVersion(tx, transcript.id) : [];
  const currentById = new Map(current.map((t) => [t.id, t]));

  const rows = new Map<string, TurnRow | null>(current.map((t) => [t.id, t]));
  const load = (ids: readonly string[]) => {
    const missing = [...new Set(ids)].filter((id) => !rows.has(id));
    if (missing.length === 0) return;
    const found = new Map(tx.select().from(turns).where(inArray(turns.id, missing)).all().map((t) => [t.id, t]));
    for (const id of missing) rows.set(id, found.get(id) ?? null);
  };
  load(preload);
  const turnRow = (id: string): TurnRow | null => {
    load([id]);
    return rows.get(id) ?? null;
  };

  const versionTurns = new Map<string, TurnRow[]>();
  const turnsOf = (versionId: string) => {
    let list = versionTurns.get(versionId);
    if (!list) versionTurns.set(versionId, (list = turnsOfVersion(tx, versionId)));
    return list;
  };

  /** Turns lineage reports as added directly after `turn` in its version. */
  const addedAfter = (turn: TurnRow): TurnRow[] => {
    const list = turnsOf(turn.transcriptVersionId);
    const added = new Set(
      tx
        .select()
        .from(turnLineage)
        .where(and(eq(turnLineage.transcriptVersionId, turn.transcriptVersionId), eq(turnLineage.change, "added")))
        .all()
        .map((r) => r.newTurnId),
    );
    const out: TurnRow[] = [];
    for (const t of list.filter((x) => x.idx > turn.idx).sort((a, b) => a.idx - b.idx)) {
      if (!added.has(t.id)) break;
      out.push(t);
    }
    return out;
  };

  /** Fallback with no stored lineage: align the version directly with the current one. */
  const fallbacks = new Map<string, { map: Map<string, string | null>; order: { oldLabel: string | null; newLabel: string | null; change: string }[] }>();
  const viaDiff = (src: TurnRow): { turn: TurnRow | null; added: TurnRow[] } => {
    let fb = fallbacks.get(src.transcriptVersionId);
    if (!fb) {
      const order = diffTurns(turnsOf(src.transcriptVersionId).map(lineageTurn), current.map(lineageTurn));
      fb = { map: new Map(order.filter((r) => r.oldLabel).map((r) => [r.oldLabel!, r.newLabel])), order };
      fallbacks.set(src.transcriptVersionId, fb);
    }
    const label = fb.map.get(src.label);
    const turn = label ? (current.find((t) => t.label === label) ?? null) : null;
    const added: TurnRow[] = [];
    const at = fb.order.findIndex((r) => r.oldLabel === src.label);
    for (let i = at + 1; at >= 0 && i < fb.order.length && fb.order[i].change === "added"; i++) {
      const t = current.find((c) => c.label === fb.order[i].newLabel);
      if (t) added.push(t);
    }
    return { turn, added };
  };

  /**
   * Follows a turn to the current version. Returns the turn it ends on (null if removed), whether its
   * text changed on the way, and every turn split off from it on the way (followed to the current version).
   */
  const follow = (start: TurnRow): { turn: TurnRow | null; changed: boolean; split: TurnRow[] } => {
    let turn: TurnRow | null = start;
    let changed = false;
    const pending: TurnRow[] = [];
    for (let hops = 0; turn && !currentById.has(turn.id) && hops < 64; hops++) {
      if (!transcript) return { turn: null, changed: true, split: [] };
      const next = tx.select().from(turnLineage).where(eq(turnLineage.oldTurnId, turn.id)).get();
      if (!next) {
        const d = viaDiff(turn);
        if (!d.turn || d.turn.textHash !== turn.textHash) {
          changed = true;
          pending.push(...d.added);
        }
        turn = d.turn;
        break;
      }
      const to: TurnRow | null = next.newTurnId ? turnRow(next.newTurnId) : null;
      if (!to || to.textHash !== turn.textHash) {
        changed = true;
        if (to) pending.push(...addedAfter(to));
      }
      turn = to;
    }
    if (turn && !currentById.has(turn.id)) turn = null;
    // Split-off turns are followed too; whatever they became is blanked whole.
    const split: TurnRow[] = [];
    for (const t of pending) {
      const f = currentById.has(t.id) ? { turn: t, split: [] as TurnRow[] } : follow(t);
      if (f.turn) split.push(f.turn);
      split.push(...f.split);
    }
    return { turn, changed: changed || (turn !== null && turn.textHash !== start.textHash), split };
  };

  return {
    transcript,
    current,
    place(turnId, start, end) {
      const src = turnRow(turnId);
      if (!src) return null;
      const { turn, changed, split } = follow(src);
      if (!turn) return null;
      if (!changed) return [{ turn, start, end }];
      const whole = (t: TurnRow): Placed => ({ turn: t, start: 0, end: t.text.length });
      const hidden = sliceOf(src, start, end);
      const out: Placed[] = [whole(turn), ...split.map(whole)];
      for (const t of current) if (!out.some((p) => p.turn.id === t.id && p.start === 0 && p.end === t.text.length)) out.push(...verbatim(t, hidden));
      return out;
    },
    sourceLabel(turnId) {
      return turnRow(turnId)?.label ?? turnId.slice(turnId.lastIndexOf(":") + 1);
    },
    sourceText(turnId, start, end) {
      const src = turnRow(turnId);
      return src ? sliceOf(src, start, end) : null;
    },
  };
}
