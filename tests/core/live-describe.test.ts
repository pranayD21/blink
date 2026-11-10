import { describe, expect, it } from "vitest";
import { type MomentFacts, describeMoment } from "@/core/live/describe";
import type { PillDecision } from "@/core/live/pill";

const none: PillDecision = { level: "listening", reason: "none", ruleIds: [], suppressed: false };
const facts = (o: Partial<MomentFacts>): MomentFacts => ({ readStatus: "read", claimCount: 0, decision: none, linkedLabels: [], firstUnknown: null, ...o });

describe("describeMoment", () => {
  it("says there was nothing to check", () => expect(describeMoment(facts({}))).toBe("Nothing to check. Nothing shown."));
  it("says the claims were checked and no rule applies", () =>
    expect(describeMoment(facts({ claimCount: 2 }))).toBe("Checked against the policy. No rule applies. Nothing shown."));
  it("names the first unknown fact when one is short", () =>
    expect(describeMoment(facts({ claimCount: 1, firstUnknown: "whether the figure is public" }))).toBe(
      "One fact short of a rule: whether the figure is public. Watching. Nothing shown."));
  it("explains an amber from the question", () =>
    expect(describeMoment(facts({ claimCount: 1, decision: { level: "amber", reason: "question_asks_for_restricted", ruleIds: ["R1", "R4"], suppressed: false } }))).toBe(
      "The question asks for something rule R1, R4 restricts. Showed “Getting close to inside information. Steer away.”"));
  it("explains an amber from staying one fact short", () =>
    expect(describeMoment(facts({ claimCount: 1, decision: { level: "amber", reason: "still_one_fact_short", ruleIds: ["R1"], suppressed: false } }))).toBe(
      "Still one fact short of rule R1, and the conversation stayed on it. Showed “Getting close to inside information. Steer away.”"));
  it("says why a held-back amber was not shown", () =>
    expect(describeMoment(facts({ claimCount: 1, decision: { level: "listening", reason: "question_asks_for_restricted", ruleIds: ["R1"], suppressed: true } }))).toBe(
      "The question asks for something rule R1 restricts. Not shown: a warning was shown less than 30 seconds earlier."));
  it("explains a red with its links", () =>
    expect(describeMoment(facts({ claimCount: 3, linkedLabels: ["T5"], decision: { level: "red", reason: "rule_met", ruleIds: ["R1", "R2"], suppressed: false } }))).toBe(
      "Rule R1, R2 is met, linking back to T5. Showed “Sounds like inside information. Move on.”"));
  it("says when the turn was not read live", () =>
    expect(describeMoment(facts({ readStatus: "timeout" }))).toBe("Not read live (timeout). Covered by the after-call read. Nothing shown."));
});
