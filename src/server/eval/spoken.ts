/**
 * Pure helpers for `pnpm eval:spoken` (Task 38): laying a written call out as two channels of
 * speech, finding which written turn a heard turn came from, and scoring a transcript against a
 * reference (word error rate on an alignment, and how many chosen reference words came out right).
 * No I/O, clock or randomness; the script does the speaking, streaming and posting.
 */
import type { Channel } from "@/core/live/turns";
import type { SpeakerRole } from "@/core/transcript/parse";

/**
 * The Flux address the banker's app opens (`src/lib/live/flux-client.ts`). Copied, not imported,
 * because the eval never loads the browser modules; a test keeps the two the same.
 */
export const SPOKEN_FLUX_URL = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.8&eot_timeout_ms=7000";

/** The banker is on the microphone; everyone else on the call (expert, moderator) reaches the app through the computer's audio. */
export const channelFor = (role: SpeakerRole): Channel => (role === "analyst" ? "analyst" : "expert");

export interface TurnToPlace {
  label: string;
  role: SpeakerRole;
  durationMs: number;
}

export interface PlacedTurn {
  label: string;
  role: SpeakerRole;
  channel: Channel;
  startMs: number;
  endMs: number;
}

export interface LayoutOptions {
  /** Silence before the first turn. */
  leadMs: number;
  /** Silence before a turn on the other channel from the turn before it: ordinary turn-taking. */
  switchGapMs: number;
  /**
   * Silence before a turn on the same channel as the turn before it. Flux ends a turn only after
   * about two seconds of silence (notes, "Spike: speed"), so this must be longer than that or the
   * two turns are heard as one.
   */
  sameChannelGapMs: number;
}

/** Plays the turns one after another, never overlapping, each on its speaker's channel. */
export function layoutTurns(turns: readonly TurnToPlace[], opts: LayoutOptions): PlacedTurn[] {
  const placed: PlacedTurn[] = [];
  for (const t of turns) {
    const channel = channelFor(t.role);
    const prev = placed.at(-1);
    const startMs = prev ? prev.endMs + (prev.channel === channel ? opts.sameChannelGapMs : opts.switchGapMs) : opts.leadMs;
    placed.push({ label: t.label, role: t.role, channel, startMs, endMs: startMs + t.durationMs });
  }
  return placed;
}

/**
 * The two channels as 16-bit samples: each turn's samples written into its own channel from its
 * start, silence everywhere else, and `tailMs` of silence after the last turn so Flux can end it.
 */
export function mixChannels(placed: readonly PlacedTurn[], pcm: readonly Int16Array[], opts: { sampleRate: number; tailMs: number }): Record<Channel, Int16Array> {
  if (placed.length !== pcm.length) throw new Error(`${placed.length} turns but ${pcm.length} sets of samples`);
  const at = (ms: number) => Math.round((ms * opts.sampleRate) / 1000);
  const end = placed.reduce((n, p, i) => Math.max(n, at(p.startMs) + pcm[i].length), 0);
  const length = end + at(opts.tailMs);
  const out: Record<Channel, Int16Array> = { analyst: new Int16Array(length), expert: new Int16Array(length) };
  placed.forEach((p, i) => out[p.channel].set(pcm[i], at(p.startMs)));
  return out;
}

/** A heard turn must share this much time with a written turn to count as coming from it... */
export const MIN_OVERLAP_MS = 150;
/** ...and with no such turn, the nearest written turn on its channel within this distance is taken. */
export const NEAREST_WITHIN_MS = 500;

/**
 * The written turns a heard turn came from: those on its channel whose speech overlaps its audio
 * window (by MIN_OVERLAP_MS, or by half of a shorter turn), in order. Flux may join two written
 * turns into one, so there can be several. With none, the nearest within NEAREST_WITHIN_MS.
 */
export function sourceTurnsOf(heard: { channel: Channel; startMs: number; endMs: number }, placed: readonly PlacedTurn[]): string[] {
  const mine = placed.filter((p) => p.channel === heard.channel);
  const overlapping = mine.filter((p) => {
    const overlap = Math.min(p.endMs, heard.endMs) - Math.max(p.startMs, heard.startMs);
    return overlap > 0 && (overlap >= MIN_OVERLAP_MS || overlap * 2 >= p.endMs - p.startMs);
  });
  if (overlapping.length > 0) return overlapping.map((p) => p.label);
  const distance = (p: PlacedTurn) => Math.max(p.startMs - heard.endMs, heard.startMs - p.endMs, 0);
  const nearest = [...mine].sort((a, b) => distance(a) - distance(b))[0];
  return nearest && distance(nearest) <= NEAREST_WITHIN_MS ? [nearest.label] : [];
}

// ── Transcription accuracy ──────────────────────────────────────────────────

/**
 * Words for the error rate: lowercased; hyphens, dashes and slashes become spaces (they join two
 * words); every other character that is not a letter, a digit or a space is removed, so "$5.2" is
 * "52" and "It's" is "its"; then split on spaces. Nothing is expanded: "21" and "twenty one" differ.
 */
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-‐‑‒–—―/]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
}

export interface ReferenceWord {
  word: string;
  /** Entity types from the token's `tags` (`id:TYPE`) and its `wer_tags` ids, in first-seen order. */
  entities: string[];
}

const NLP_HEADER = "token|speaker|ts|endTs|punctuation|case|tags|wer_tags";
const quoted = (list: string) => [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);

/**
 * An Earnings-21 `.nlp` reference (one token per line) as normalised words, each with its entity
 * types. `types` maps a wer_tags id to its entity type, from the file's `<id>.wer_tag.json`.
 */
export function nlpReference(nlp: string, types: Readonly<Record<string, string>>): ReferenceWord[] {
  const lines = nlp.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0] !== NLP_HEADER) throw new Error(`not an Earnings-21 .nlp file: the first line should be "${NLP_HEADER}"`);
  const words: ReferenceWord[] = [];
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const cols = line.split("|");
    const entities = [...new Set([...quoted(cols[6] ?? "").map((t) => t.split(":")[1] ?? ""), ...quoted(cols[7] ?? "").map((id) => types[id] ?? "")].filter(Boolean))];
    for (const word of normalizeWords(cols[0])) words.push({ word, entities });
  }
  return words;
}

export interface Alignment {
  /** How many reference words, from the start, the hypothesis covers. */
  refUsed: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  /** (substitutions + deletions + insertions) / refUsed; null when no reference word is covered. */
  wer: number | null;
  /** For each covered reference word, the hypothesis word aligned to it, or null when it was deleted. */
  refToHyp: (number | null)[];
  /** For each covered reference word, whether the aligned hypothesis word is the same word. */
  matched: boolean[];
}

const DIAG = 1;
const UP = 2; // a reference word with no hypothesis word: a deletion
const LEFT = 3; // a hypothesis word with no reference word: an insertion

/**
 * The fewest substitutions, deletions and insertions that turn a prefix of `ref` into `hyp`
 * (Levenshtein, every edit costing 1). The prefix is free to end anywhere, because the audio was
 * cut at ten minutes and the reference has no word times; among equally good prefixes the longest
 * is used. Ties inside the alignment prefer a substitution, then a deletion, then an insertion.
 */
export function alignPrefix(ref: readonly string[], hyp: readonly string[]): Alignment {
  const n = ref.length;
  const m = hyp.length;
  const width = m + 1;
  const back = new Uint8Array((n + 1) * width);
  let prev = new Int32Array(width);
  let cur = new Int32Array(width);
  for (let j = 1; j <= m; j++) {
    prev[j] = j;
    back[j] = LEFT;
  }
  let bestI = 0;
  let bestCost = prev[m];
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    back[i * width] = UP;
    for (let j = 1; j <= m; j++) {
      const diag = prev[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1);
      const up = prev[j] + 1;
      const left = cur[j - 1] + 1;
      let cost = diag;
      let dir = DIAG;
      if (up < cost) {
        cost = up;
        dir = UP;
      }
      if (left < cost) {
        cost = left;
        dir = LEFT;
      }
      cur[j] = cost;
      back[i * width + j] = dir;
    }
    if (cur[m] <= bestCost) {
      bestCost = cur[m];
      bestI = i;
    }
    [prev, cur] = [cur, prev];
  }

  const refToHyp: (number | null)[] = new Array(bestI).fill(null);
  const matched: boolean[] = new Array(bestI).fill(false);
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let i = bestI;
  let j = m;
  while (i > 0 || j > 0) {
    const dir = i === 0 ? LEFT : j === 0 ? UP : back[i * width + j];
    if (dir === DIAG) {
      refToHyp[i - 1] = j - 1;
      matched[i - 1] = ref[i - 1] === hyp[j - 1];
      if (!matched[i - 1]) substitutions++;
      i--;
      j--;
    } else if (dir === UP) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }
  const errors = substitutions + deletions + insertions;
  return { refUsed: bestI, substitutions, deletions, insertions, wer: bestI === 0 ? null : errors / bestI, refToHyp, matched };
}

/** Of the covered reference words `pick` chooses, how many the hypothesis has right at the aligned position. */
export function tokenAccuracy(a: Alignment, pick: (refIndex: number) => boolean): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (let i = 0; i < a.refUsed; i++) {
    if (!pick(i)) continue;
    total++;
    if (a.matched[i]) correct++;
  }
  return { correct, total };
}

// ── Live flags against the after-call read ──────────────────────────────────

const turnNo = (label: string) => Number(/\d+/.exec(label)?.[0] ?? Number.MAX_SAFE_INTEGER);
const ordered = (labels: Iterable<string>) => [...new Set(labels)].sort((a, b) => turnNo(a) - turnNo(b) || a.localeCompare(b));

/** Which turns the live read and the after-call read both flagged, and which only one did. */
export function compareFlags(live: readonly string[], after: readonly string[]): { both: string[]; liveOnly: string[]; afterOnly: string[]; match: boolean } {
  const a = new Set(after);
  const l = new Set(live);
  const both = ordered(live.filter((t) => a.has(t)));
  const liveOnly = ordered(live.filter((t) => !a.has(t)));
  const afterOnly = ordered(after.filter((t) => !l.has(t)));
  return { both, liveOnly, afterOnly, match: liveOnly.length === 0 && afterOnly.length === 0 };
}
