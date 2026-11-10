/**
 * Quote location and validation (§10.3, decision D6).
 *
 * Models are unreliable at character offsets, so they return a turn id and a
 * verbatim quote; this module finds the quote and computes the offsets. A
 * quote that cannot be found is dropped — missing grounding lowers certainty
 * and never raises it.
 */

export interface QuoteMatch {
  start: number;
  end: number;
  /** True when the match needed whitespace / curly-quote / dash normalization. */
  normalized: boolean;
}

const CHAR_MAP: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
  " ": " ",
};

/**
 * Normalizes text for matching: collapses whitespace runs to one space and
 * unifies curly/straight quotes and dashes. Case is preserved. Returns the
 * normalized string and, for each normalized character, the index of the
 * original character it came from.
 */
export function normalizeWithMap(text: string): { text: string; map: number[] } {
  let out = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const raw = text[i];
    const ch = CHAR_MAP[raw] ?? raw;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      out += " ";
      map.push(i);
      lastWasSpace = true;
    } else {
      out += ch;
      map.push(i);
      lastWasSpace = false;
    }
  }
  return { text: out, map };
}

/** Finds `quote` in `text`: exact first, then normalized with offsets mapped back to the original. */
export function locateQuote(text: string, quote: string): QuoteMatch | null {
  if (!quote) return null;
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length, normalized: false };

  const haystack = normalizeWithMap(text);
  const needle = normalizeWithMap(quote).text.trim();
  if (!needle) return null;
  const at = haystack.text.indexOf(needle);
  if (at < 0) return null;
  const start = haystack.map[at];
  const end = haystack.map[at + needle.length - 1] + 1;
  return { start, end, normalized: true };
}

export interface QuoteTurn {
  /** Display id, e.g. "T7". */
  label: string;
  idx: number;
  speaker: string;
  text: string;
}

export type QuoteValidation =
  | { status: "ok"; turnLabel: string; match: QuoteMatch; reassignedFrom: null }
  | { status: "reassigned"; turnLabel: string; match: QuoteMatch; reassignedFrom: string }
  | { status: "not_found"; reason: string };

/**
 * Validates one model-proposed quote against the transcript.
 *  1. exact match in the referenced turn
 *  2. normalized match in the referenced turn
 *  3. otherwise, if the quote appears in exactly one other expert turn, reattach it there
 *  4. otherwise drop it
 */
export function validateQuote(turnLabel: string, quote: string, turns: readonly QuoteTurn[]): QuoteValidation {
  const turn = turns.find((t) => t.label === turnLabel);
  if (turn) {
    const match = locateQuote(turn.text, quote);
    if (match) return { status: "ok", turnLabel, match, reassignedFrom: null };
  }
  const elsewhere = turns
    .filter((t) => t.label !== turnLabel && t.speaker === "expert")
    .map((t) => ({ turn: t, match: locateQuote(t.text, quote) }))
    .filter((x): x is { turn: QuoteTurn; match: QuoteMatch } => x.match !== null);
  if (elsewhere.length === 1) {
    return { status: "reassigned", turnLabel: elsewhere[0].turn.label, match: elsewhere[0].match, reassignedFrom: turnLabel };
  }
  return {
    status: "not_found",
    reason: !turn
      ? `turn ${turnLabel} does not exist`
      : elsewhere.length > 1
        ? `not in ${turnLabel}, and ambiguous: appears in ${elsewhere.map((x) => x.turn.label).join(", ")}`
        : `not found in ${turnLabel} or any expert turn`,
  };
}
