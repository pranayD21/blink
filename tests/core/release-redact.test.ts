import { describe, expect, it } from "vitest";
import { mergeSpans, redactTurns } from "@/core/release/redact";

const turn = { label: "T5", speaker: "expert", speakerName: "R", timestamp: null, text: "Honestly, orders fell. Down twenty percent." };
const other = { label: "T6", speaker: "analyst", speakerName: "A", timestamp: "00:10", text: "Thanks." };

describe("blanking spans", () => {
  it("blanks a span and keeps the rest", () =>
    expect(redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 22 }]).turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 12 }, { text: " Down twenty percent." }]));

  it("Review Focus 5: overlapping and touching spans merge, and nothing between them shows", () => {
    const r = redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 22 }, { turnLabel: "T5", start: 18, end: 30 }, { turnLabel: "T5", start: 30, end: 43 }]);
    expect(r.turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 33 }]);
    expect(r.hiddenPassages).toBe(1);
  });

  it("Review Focus 5: a span at the very start or end leaves no empty text segment", () => {
    expect(redactTurns([turn], [{ turnLabel: "T5", start: 0, end: 9 }]).turns[0].segments[0]).toEqual({ hidden: 9 });
    const end = redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 43 }]).turns[0].segments;
    expect(end).toEqual([{ text: "Honestly, " }, { hidden: 33 }]);
    const all = redactTurns([turn], [{ turnLabel: "T5", start: 0, end: 43 }]).turns[0].segments;
    expect(all).toEqual([{ hidden: 43 }]);
  });

  it("a span past the end of the text is clamped, and an unknown turn label is ignored", () => {
    const r = redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 999 }, { turnLabel: "T99", start: 0, end: 5 }]);
    expect(r.turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 33 }]);
    expect(r.hiddenPassages).toBe(1);
    const none = redactTurns([turn], [{ turnLabel: "T99", start: 0, end: 5 }]);
    expect(none.turns[0].segments).toEqual([{ text: turn.text }]);
    expect(none.hiddenPassages).toBe(0);
  });

  it("a span that is empty after clamping is ignored", () => {
    const r = redactTurns([turn], [{ turnLabel: "T5", start: 50, end: 60 }, { turnLabel: "T5", start: 5, end: 5 }, { turnLabel: "T5", start: -9, end: 0 }]);
    expect(r.turns[0].segments).toEqual([{ text: turn.text }]);
    expect(r.hiddenPassages).toBe(0);
  });

  it("counts merged spans across all turns and keeps turn metadata", () => {
    const r = redactTurns([turn, other], [{ turnLabel: "T6", start: 0, end: 3 }, { turnLabel: "T5", start: 0, end: 2 }, { turnLabel: "T5", start: 5, end: 7 }]);
    expect(r.hiddenPassages).toBe(3);
    expect(r.turns[1]).toEqual({ label: "T6", speaker: "analyst", speakerName: "A", timestamp: "00:10", segments: [{ hidden: 3 }, { text: "nks." }] });
  });

  it("the output never contains a blanked character", () =>
    expect(JSON.stringify(redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 22 }]))).not.toContain("orders fell"));

  it("mergeSpans sorts by turn then start and does not change its input", () => {
    const input = [{ turnLabel: "T6", start: 4, end: 6 }, { turnLabel: "T5", start: 8, end: 9 }, { turnLabel: "T5", start: 1, end: 3 }];
    expect(mergeSpans(input)).toEqual([{ turnLabel: "T5", start: 1, end: 3 }, { turnLabel: "T5", start: 8, end: 9 }, { turnLabel: "T6", start: 4, end: 6 }]);
    expect(input[0]).toEqual({ turnLabel: "T6", start: 4, end: 6 });
  });

  it("a reversed span is swapped, so it still blanks", () => {
    const r = redactTurns([turn], [{ turnLabel: "T5", start: 22, end: 10 }]);
    expect(r.turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 12 }, { text: " Down twenty percent." }]);
    expect(mergeSpans([{ turnLabel: "T5", start: 22, end: 10 }])).toEqual([{ turnLabel: "T5", start: 10, end: 22 }]);
  });

  it("a non-finite offset is refused rather than left visible", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => redactTurns([turn], [{ turnLabel: "T5", start: bad, end: 22 }])).toThrow(/finite/);
      expect(() => redactTurns([turn], [{ turnLabel: "T5", start: 10, end: bad }])).toThrow(/finite/);
      expect(() => redactTurns([turn], [{ turnLabel: "T99", start: bad, end: 22 }])).toThrow(/finite/);
    }
  });

  it("fractional offsets round outward and hidden counts are whole numbers", () => {
    const r = redactTurns([turn], [{ turnLabel: "T5", start: 10.4, end: 21.9 }]);
    expect(r.turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 12 }, { text: " Down twenty percent." }]);
  });

  it("a duplicate turn label is refused", () => {
    expect(() => redactTurns([turn, { ...other, label: "T5" }], [])).toThrow(/Duplicate turn label T5/);
  });

  it("never shows half of a character outside the basic plane", () => {
    const emoji = { label: "T1", speaker: "expert", speakerName: "R", timestamp: null, text: "a\u{1F600}b" };
    expect(redactTurns([emoji], [{ turnLabel: "T1", start: 2, end: 4 }]).turns[0].segments).toEqual([{ text: "a" }, { hidden: 3 }]);
    expect(redactTurns([emoji], [{ turnLabel: "T1", start: 0, end: 2 }]).turns[0].segments).toEqual([{ hidden: 3 }, { text: "b" }]);
    expect(redactTurns([emoji], [{ turnLabel: "T1", start: 2, end: 3 }]).turns[0].segments).toEqual([{ text: "a" }, { hidden: 2 }, { text: "b" }]);
  });

  it("a span fully inside another changes nothing", () => {
    const r = redactTurns([turn], [{ turnLabel: "T5", start: 10, end: 30 }, { turnLabel: "T5", start: 14, end: 18 }]);
    expect(r.turns[0].segments).toEqual([{ text: "Honestly, " }, { hidden: 20 }, { text: turn.text.slice(30) }]);
    expect(r.hiddenPassages).toBe(1);
  });

  it("overlapping spans in two turns at once merge separately", () => {
    const r = redactTurns(
      [turn, other],
      [{ turnLabel: "T6", start: 0, end: 4 }, { turnLabel: "T5", start: 0, end: 5 }, { turnLabel: "T6", start: 2, end: 6 }, { turnLabel: "T5", start: 3, end: 8 }],
    );
    expect(r.hiddenPassages).toBe(2);
    expect(r.turns[0].segments[0]).toEqual({ hidden: 8 });
    expect(r.turns[1].segments).toEqual([{ hidden: 6 }, { text: "." }]);
  });
});
