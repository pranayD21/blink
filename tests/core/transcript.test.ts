import { describe, expect, it } from "vitest";
import { TranscriptParseError, detectFormat, parseTranscript } from "@/core/transcript/parse";
import { readFixture } from "../helpers/fixtures";

describe("transcript parser (§10.1)", () => {
  const v1 = readFixture("cases", "halvorsen", "transcript-v1.txt");

  it("parses the Halvorsen transcript into T1…T22 with roles and names", () => {
    const parsed = parseTranscript(v1, { filename: "transcript-v1.txt" });
    expect(parsed.format).toBe("txt");
    expect(parsed.turns).toHaveLength(22);
    expect(parsed.turns.map((t) => t.label)).toEqual(Array.from({ length: 22 }, (_, i) => `T${i + 1}`));
    expect(parsed.turns[0]).toMatchObject({ speaker: "moderator", speakerName: "Meridian", timestamp: "00:00:05" });
    expect(parsed.turns[4]).toMatchObject({ label: "T5", speaker: "expert", speakerName: "R. Castellano", text: "Honestly, orders fell off a cliff. They're down about twenty percent." });
    expect(parsed.turns[10].text).toContain("I still have a login to their pipeline dashboard in Salesforce.");
    expect(parsed.turns[21]).toMatchObject({ label: "T22", speaker: "analyst" });
    expect(parsed.unknownSpeakers).toEqual([]);
  });

  it("offsets point at each turn's text in the raw transcript", () => {
    const parsed = parseTranscript(v1);
    for (const t of parsed.turns) expect(parsed.rawText.slice(t.startChar, t.endChar)).toBe(t.text);
  });

  it("normalizes line endings and joins continuation lines", () => {
    const parsed = parseTranscript("Analyst: first line\r\nsecond line\r\n\r\nExpert: reply\r\n");
    expect(parsed.turns.map((t) => t.text)).toEqual(["first line\nsecond line", "reply"]);
    expect(parsed.rawText).not.toContain("\r");
    for (const t of parsed.turns) expect(parsed.rawText.slice(t.startChar, t.endChar)).toBe(t.text);
  });

  it("sends unknown speaker labels to moderator until they are mapped", () => {
    const text = "Host: welcome\nSME (Dana): hello\nAnalyst: hi\n";
    const first = parseTranscript(text);
    expect(first.unknownSpeakers).toEqual(["Host", "SME"]);
    expect(first.turns.map((t) => t.speaker)).toEqual(["moderator", "moderator", "analyst"]);
    const mapped = parseTranscript(text, { speakerMap: { SME: "expert", Host: "moderator" } });
    expect(mapped.unknownSpeakers).toEqual([]);
    expect(mapped.turns[1]).toMatchObject({ speaker: "expert", speakerName: "Dana" });
  });

  it("parses WebVTT and merges consecutive cues by speaker", () => {
    const vtt = ["WEBVTT", "", "1", "00:00:05.000 --> 00:00:09.000", "<v Analyst (Priya)>How is demand?", "", "2", "00:00:10.000 --> 00:00:14.000", "<v Expert>Orders fell.", "", "3", "00:00:14.000 --> 00:00:18.000", "<v Expert>About twenty percent.", ""].join("\n");
    const parsed = parseTranscript(vtt);
    expect(parsed.format).toBe("vtt");
    expect(parsed.turns.map((t) => [t.label, t.speaker, t.speakerName, t.text])).toEqual([
      ["T1", "analyst", "Priya", "How is demand?"],
      ["T2", "expert", "", "Orders fell. About twenty percent."],
    ]);
    expect(parsed.turns[1].timestamp).toBe("00:00:10");
  });

  it("parses the JSON form", () => {
    const parsed = parseTranscript(JSON.stringify([{ speaker: "Analyst", name: "Priya", text: "How is demand?" }, { speaker: "Expert", text: "Orders fell." }]));
    expect(parsed.format).toBe("json");
    expect(parsed.turns.map((t) => [t.label, t.speaker, t.speakerName, t.text])).toEqual([["T1", "analyst", "Priya", "How is demand?"], ["T2", "expert", "", "Orders fell."]]);
  });

  it("detects format from the file name or the content", () => {
    expect(detectFormat("anything", "call.vtt")).toBe("vtt");
    expect(detectFormat('[{"speaker":"a","text":"b"}]')).toBe("json");
    expect(detectFormat("[00:00:05] Analyst: hi")).toBe("txt");
  });

  it("rejects empty or speakerless input with a clear error", () => {
    expect(() => parseTranscript("   \n")).toThrow(TranscriptParseError);
    expect(() => parseTranscript("just some prose with no speaker")).toThrow(/no speaker label/);
    expect(() => parseTranscript("{not json", { filename: "x.json" })).toThrow(/invalid JSON/);
  });
});
