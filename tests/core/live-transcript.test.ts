import { describe, expect, it } from "vitest";
import { liveTranscriptText } from "@/core/live/transcript";
import { parseTranscript } from "@/core/transcript/parse";

describe("live transcript text", () => {
  it("one line per turn, and the parser reads back the same turns", () => {
    const turns = [
      { seq: 1, speaker: "analyst", text: "How is demand?", speechStartMs: 1000, speechEndMs: 3000 },
      { seq: 2, speaker: "expert", text: "Soft.\nVery soft.", speechStartMs: 70000, speechEndMs: 72000 },
    ] as const;
    const text = liveTranscriptText(turns, { analyst: "Priya Raman", expert: "R. Castellano" });
    expect(text.split("\n")).toEqual(["[00:00:01] Analyst (Priya Raman): How is demand?", "[00:01:10] Expert (R. Castellano): Soft. Very soft."]);
    expect(parseTranscript(text, { filename: "live-call.txt" }).turns.map((t) => [t.label, t.speaker, t.text])).toEqual([
      ["T1", "analyst", "How is demand?"],
      ["T2", "expert", "Soft. Very soft."],
    ]);
  });

  it("times a turn with no known start from its end", () => {
    const text = liveTranscriptText([{ seq: 1, speaker: "expert", text: "Yes.", speechStartMs: null, speechEndMs: 3_725_000 }], { analyst: "A", expert: "E" });
    expect(text).toBe("[01:02:05] Expert (E): Yes.");
  });
});
