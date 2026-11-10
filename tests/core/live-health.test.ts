import { describe, expect, it } from "vitest";
import { brokenStage } from "@/core/live/health";

describe("brokenStage", () => {
  it("names a stage down more than three seconds", () => expect(brokenStage(10_000, { transcribing: 6_999 })).toBe("transcribing"));
  it("does not name one down exactly three seconds", () => expect(brokenStage(10_000, { transcribing: 7_000 })).toBeNull());
  it("is null when nothing is down", () => expect(brokenStage(10_000, {})).toBeNull());
  it("returns the first stage in pipeline order", () => expect(brokenStage(10_000, { screen: 1_000, reading: 1_000, hearing: 9_000 })).toBe("reading"));
});
