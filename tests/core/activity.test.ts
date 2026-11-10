/** The live trace says what the agent did, and never repeats the words that were said. */
import { describe, expect, it } from "vitest";
import { activityLine } from "@/core/live/activity";

describe("activityLine", () => {
  it("names a met rule without the sentence", () => {
    expect(activityLine({ readStatus: "read", level: "red", reason: "rule_met", suppressed: false })).toBe("A rule is met. Move on.");
  });

  it("says when a warning was held back", () => {
    expect(activityLine({ readStatus: "read", level: "listening", reason: "question_asks_for_restricted", suppressed: true })).toMatch(/stays quiet/);
  });

  it("says when the read did not finish", () => {
    expect(activityLine({ readStatus: "timeout", level: "listening", reason: "none", suppressed: false })).toMatch(/after the call/);
  });
});
