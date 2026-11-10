// Blanking restricted passages out of a transcript. Pure: the output carries only how many characters
// were blanked, never the characters, so nothing downstream can leak what was hidden.

export interface Span {
  turnLabel: string;
  start: number;
  end: number;
}

export type Segment = { text: string } | { hidden: number };

export interface RedactedTurn {
  label: string;
  speaker: string;
  speakerName: string;
  timestamp: string | null;
  segments: Segment[];
}

/** Makes a span safe to blank with: whole offsets, start before end, widened (never narrowed) by rounding. */
function normalizeSpan(s: Span): Span {
  if (!Number.isFinite(s.start) || !Number.isFinite(s.end)) {
    throw new Error(`Cannot blank span in turn ${s.turnLabel}: start and end must be finite numbers`);
  }
  const lo = Math.min(s.start, s.end);
  const hi = Math.max(s.start, s.end);
  return { turnLabel: s.turnLabel, start: Math.floor(lo), end: Math.ceil(hi) };
}

/**
 * Sorts by turn then start and joins spans that overlap or touch. Spans are made whole and ordered first
 * (a reversed span is swapped, fractions round outward) and empty ones are dropped; a non-finite offset throws.
 */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans
    .map(normalizeSpan)
    .filter((s) => s.end > s.start)
    .sort((a, b) => (a.turnLabel < b.turnLabel ? -1 : a.turnLabel > b.turnLabel ? 1 : a.start - b.start));
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && last.turnLabel === span.turnLabel && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push(span);
    }
  }
  return merged;
}

const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

export function redactTurns(
  turns: readonly { label: string; speaker: string; speakerName: string; timestamp: string | null; text: string }[],
  spans: readonly Span[],
): { turns: RedactedTurn[]; hiddenPassages: number } {
  const texts = new Map<string, string>();
  for (const t of turns) {
    if (texts.has(t.label)) throw new Error(`Duplicate turn label ${t.label}`);
    texts.set(t.label, t.text);
  }
  const clamped: Span[] = [];
  for (const raw of spans) {
    const s = normalizeSpan(raw); // validates every span, even one for an unknown turn
    const text = texts.get(s.turnLabel);
    if (text === undefined) continue;
    let start = Math.max(0, Math.min(s.start, text.length));
    let end = Math.max(0, Math.min(s.end, text.length));
    // Never cut a character in half: widen to the whole surrogate pair.
    if (start > 0 && start < text.length && isLow(text.charCodeAt(start)) && isHigh(text.charCodeAt(start - 1))) start -= 1;
    if (end > 0 && end < text.length && isLow(text.charCodeAt(end)) && isHigh(text.charCodeAt(end - 1))) end += 1;
    if (end > start) clamped.push({ turnLabel: s.turnLabel, start, end });
  }
  const merged = mergeSpans(clamped);

  const out: RedactedTurn[] = turns.map((turn) => {
    const segments: Segment[] = [];
    let cursor = 0;
    for (const span of merged) {
      if (span.turnLabel !== turn.label) continue;
      if (span.start > cursor) segments.push({ text: turn.text.slice(cursor, span.start) });
      segments.push({ hidden: span.end - span.start });
      cursor = span.end;
    }
    if (cursor < turn.text.length) segments.push({ text: turn.text.slice(cursor) });
    return { label: turn.label, speaker: turn.speaker, speakerName: turn.speakerName, timestamp: turn.timestamp, segments };
  });
  return { turns: out, hiddenPassages: merged.length };
}

/** True only when the whole quote sits inside one visible run of the turn: a quote that touches or crosses a blanked run is not. */
export function quoteIsVisible(turns: readonly RedactedTurn[], turnLabel: string, quote: string): boolean {
  if (quote.length === 0) return false;
  const turn = turns.find((t) => t.label === turnLabel);
  return !!turn && turn.segments.some((segment) => "text" in segment && segment.text.includes(quote));
}
