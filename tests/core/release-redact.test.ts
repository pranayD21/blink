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
});
