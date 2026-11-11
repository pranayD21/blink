import { describe, expect, it } from "vitest";
import { FLUX_URL } from "@/lib/live/flux-client";
import {
  SPOKEN_FLUX_URL,
  alignPrefix,
  channelFor,
  compareFlags,
  layoutTurns,
  mixChannels,
  nlpReference,
  normalizeWords,
  sourceTurnsOf,
  tokenAccuracy,
} from "@/server/eval/spoken";

describe("channelFor", () => {
  it("puts the banker on the microphone and everyone else on the computer's audio", () => {
    expect(channelFor("analyst")).toBe("analyst");
    expect(channelFor("expert")).toBe("expert");
    expect(channelFor("moderator")).toBe("expert");
  });
});

describe("layoutTurns", () => {
  const turns = [
    { label: "T1", role: "moderator" as const, durationMs: 2000 },
    { label: "T2", role: "analyst" as const, durationMs: 1000 },
    { label: "T3", role: "expert" as const, durationMs: 3000 },
    { label: "T4", role: "expert" as const, durationMs: 500 },
  ];

  it("plays turns one after another, with a short gap when the channel changes and a long one when it does not", () => {
    const placed = layoutTurns(turns, { leadMs: 1000, switchGapMs: 800, sameChannelGapMs: 3000 });
    expect(placed).toEqual([
      { label: "T1", role: "moderator", channel: "expert", startMs: 1000, endMs: 3000 },
      { label: "T2", role: "analyst", channel: "analyst", startMs: 3800, endMs: 4800 },
      { label: "T3", role: "expert", channel: "expert", startMs: 5600, endMs: 8600 },
      { label: "T4", role: "expert", channel: "expert", startMs: 11600, endMs: 12100 },
    ]);
  });

  it("treats the moderator and the expert as one channel, so the gap between them is the long one", () => {
    const placed = layoutTurns(
      [
        { label: "T1", role: "moderator", durationMs: 1000 },
        { label: "T2", role: "expert", durationMs: 1000 },
      ],
      { leadMs: 0, switchGapMs: 500, sameChannelGapMs: 2500 },
    );
    expect(placed[1].startMs).toBe(3500);
  });
});

describe("mixChannels", () => {
  it("writes each turn's samples into its own channel at its start, leaving silence elsewhere", () => {
    const placed = [
      { label: "T1", role: "analyst" as const, channel: "analyst" as const, startMs: 1, endMs: 2 },
      { label: "T2", role: "expert" as const, channel: "expert" as const, startMs: 3, endMs: 5 },
    ];
    const pcm = [Int16Array.from([7]), Int16Array.from([8, 9])];
    const out = mixChannels(placed, pcm, { sampleRate: 1000, tailMs: 2 });
    expect([...out.analyst]).toEqual([0, 7, 0, 0, 0, 0, 0]);
    expect([...out.expert]).toEqual([0, 0, 0, 8, 9, 0, 0]);
  });

  it("refuses a turn and samples that do not line up", () => {
    expect(() => mixChannels([{ label: "T1", role: "analyst", channel: "analyst", startMs: 0, endMs: 1 }], [], { sampleRate: 1000, tailMs: 0 })).toThrow();
  });
});

describe("sourceTurnsOf", () => {
  const placed = layoutTurns(
    [
      { label: "T1", role: "analyst", durationMs: 2000 },
      { label: "T2", role: "expert", durationMs: 2000 },
      { label: "T3", role: "expert", durationMs: 2000 },
      { label: "T4", role: "analyst", durationMs: 2000 },
    ],
    { leadMs: 0, switchGapMs: 1000, sameChannelGapMs: 3000 },
  );
  // T1 0-2000 (analyst), T2 3000-5000, T3 8000-10000 (expert), T4 11000-13000 (analyst)

  it("finds the written turn a heard turn came from, on its own channel only", () => {
    expect(sourceTurnsOf({ channel: "expert", startMs: 3100, endMs: 4900 }, placed)).toEqual(["T2"]);
    expect(sourceTurnsOf({ channel: "analyst", startMs: 3100, endMs: 4900 }, placed)).toEqual([]);
  });

  it("names every written turn a heard turn spans, in order", () => {
    expect(sourceTurnsOf({ channel: "expert", startMs: 3000, endMs: 9900 }, placed)).toEqual(["T2", "T3"]);
  });

  it("allows for an audio window that starts or ends a little outside the speech", () => {
    expect(sourceTurnsOf({ channel: "analyst", startMs: 10_900, endMs: 13_200 }, placed)).toEqual(["T4"]);
    expect(sourceTurnsOf({ channel: "analyst", startMs: 2100, endMs: 2400 }, placed)).toEqual(["T1"]);
    expect(sourceTurnsOf({ channel: "analyst", startMs: 5000, endMs: 6000 }, placed)).toEqual([]);
  });
});

describe("normalizeWords", () => {
  it("lowercases, strips punctuation inside and around words, and splits on spaces", () => {
    expect(normalizeWords("Hello, World! It's $5.2 million (21%).")).toEqual(["hello", "world", "its", "52", "million", "21"]);
  });
  it("splits on hyphens, dashes and slashes, since they join two words", () => {
    expect(normalizeWords("COVID-19 and/or year—end")).toEqual(["covid", "19", "and", "or", "year", "end"]);
  });
  it("expands nothing: a spelled-out number stays words", () => {
    expect(normalizeWords("twenty one")).toEqual(["twenty", "one"]);
  });
  it("drops a token that is only punctuation", () => {
    expect(normalizeWords("well . . . so")).toEqual(["well", "so"]);
  });
});

describe("nlpReference", () => {
  const nlp = [
    "token|speaker|ts|endTs|punctuation|case|tags|wer_tags",
    "Welcome|0||||UC|[]|[]",
    "to|0||||LC|[]|['4']",
    "ZAGG|0||||CA|['1:ABBREVIATION']|['1', '4', '1000']",
    "10-K|1||||CA|['10:ALPHANUMERIC']|['10']",
    "*|0||||LC|['576:FALLBACK']|[]",
    "$115|2|||.|CA|['71:MONEY']|['71']",
  ].join("\n");
  // The entity types of the wer_tags ids, from the file's <id>.wer_tag.json.
  const types = { "1": "ABBREVIATION", "4": "DATE", "10": "ALPHANUMERIC", "71": "MONEY", "1000": "ORG" };

  it("reads the tokens, normalised, with the entity types its wer_tags name", () => {
    expect(nlpReference(nlp, types)).toEqual([
      { word: "welcome", entities: [] },
      { word: "to", entities: ["DATE"] },
      { word: "zagg", entities: ["ABBREVIATION", "DATE", "ORG"] },
      { word: "10", entities: ["ALPHANUMERIC"] },
      { word: "k", entities: ["ALPHANUMERIC"] },
      { word: "115", entities: ["MONEY"] },
    ]);
  });

  it("refuses a file without the expected header", () => {
    expect(() => nlpReference("token|speaker\nhi|0", {})).toThrow();
  });
});

describe("alignPrefix", () => {
  it("scores a perfect transcript of the whole reference as no errors", () => {
    const a = alignPrefix(["a", "b", "c"], ["a", "b", "c"]);
    expect(a).toMatchObject({ refUsed: 3, substitutions: 0, deletions: 0, insertions: 0, wer: 0 });
  });

  it("counts a substitution, a deletion and an insertion", () => {
    const a = alignPrefix(["a", "b", "c", "d"], ["a", "x", "d", "e"]);
    // a=a, b→x, c deleted, d=d, e inserted (the trailing "e" is an insertion: the reference ends there)
    expect(a.substitutions + a.deletions + a.insertions).toBe(3);
    expect(a.refUsed).toBe(4);
    expect(a.wer).toBeCloseTo(3 / 4);
  });

  it("compares the hypothesis with the part of the reference it covers, since the audio was cut short", () => {
    const a = alignPrefix(["a", "b", "c", "d", "e", "f"], ["a", "b", "c"]);
    expect(a).toMatchObject({ refUsed: 3, wer: 0 });
  });

  it("says which hypothesis word each reference word was aligned to", () => {
    const a = alignPrefix(["a", "b", "c"], ["a", "z", "c"]);
    expect(a.refToHyp).toEqual([0, 1, 2]);
    expect(a.matched).toEqual([true, false, true]);
  });

  it("is all deletions for an empty hypothesis, over none of the reference", () => {
    expect(alignPrefix(["a", "b"], [])).toMatchObject({ refUsed: 0, wer: null });
  });
});

describe("tokenAccuracy", () => {
  it("is the share of chosen reference words, within the part used, that the hypothesis got right where they stand", () => {
    const ref = ["revenue", "rose", "21", "percent", "at", "zagg", "and", "later", "99"];
    const a = alignPrefix(ref, ["revenue", "rose", "twenty", "one", "percent", "at", "zagg", "and"]);
    const isNumber = (i: number) => /\d/.test(ref[i]);
    expect(tokenAccuracy(a, isNumber)).toEqual({ correct: 0, total: 1 });
    expect(tokenAccuracy(a, (i) => ref[i] === "zagg")).toEqual({ correct: 1, total: 1 });
  });
});

describe("compareFlags", () => {
  it("says which turns both reads flagged, and which only one did", () => {
    expect(compareFlags(["T3", "T5"], ["T5", "T7"])).toEqual({ both: ["T5"], liveOnly: ["T3"], afterOnly: ["T7"], match: false });
    expect(compareFlags(["T10", "T2"], ["T2", "T10"])).toEqual({ both: ["T2", "T10"], liveOnly: [], afterOnly: [], match: true });
    expect(compareFlags([], [])).toEqual({ both: [], liveOnly: [], afterOnly: [], match: true });
  });
});

describe("SPOKEN_FLUX_URL", () => {
  it("is the address the banker's app opens, so the eval hears what the app hears", () => {
    expect(SPOKEN_FLUX_URL).toBe(FLUX_URL);
  });
});
