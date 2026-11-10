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

/** Sorts by turn then start and joins spans that overlap or touch. Empty or backwards spans are dropped. */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = spans
    .filter((s) => s.end > s.start)
    .map((s) => ({ ...s }))
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

export function redactTurns(
  turns: readonly { label: string; speaker: string; speakerName: string; timestamp: string | null; text: string }[],
  spans: readonly Span[],
): { turns: RedactedTurn[]; hiddenPassages: number } {
  const lengths = new Map(turns.map((t) => [t.label, t.text.length]));
  const clamped: Span[] = [];
  for (const s of spans) {
    const length = lengths.get(s.turnLabel);
    if (length === undefined) continue;
    const start = Math.max(0, Math.min(s.start, length));
    const end = Math.max(0, Math.min(s.end, length));
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
