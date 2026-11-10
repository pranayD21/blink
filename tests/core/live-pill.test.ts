import { describe, expect, it } from "vitest";
import { type MonitorMove, decidePill, endedText } from "@/core/live/pill";

const move = (prev: string, next: string, added = true): MonitorMove => ({ claimKey: "L1", ruleId: "R1", prevState: prev, nextState: next, addedQuoteThisTurn: added });

describe("decidePill", () => {
  it("entering review is red, and red is never held back", () =>
    expect(decidePill({ moves: [move("NEEDS_CONTEXT", "REVIEW_REQUIRED")], probeRuleIds: [], msSinceLastAmber: 100 })).toMatchObject({ level: "red", reason: "rule_met", ruleIds: ["R1"], suppressed: false }));
  it("the first step into needs-context shows nothing", () =>
    expect(decidePill({ moves: [move("UNASSESSED", "NEEDS_CONTEXT")], probeRuleIds: [], msSinceLastAmber: null }).level).toBe("listening"));
  it("staying one fact short on a turn that adds to the claim is amber", () =>
    expect(decidePill({ moves: [move("NEEDS_CONTEXT", "NEEDS_CONTEXT")], probeRuleIds: [], msSinceLastAmber: null })).toMatchObject({ level: "amber", reason: "still_one_fact_short" }));
  it("staying one fact short on a turn that adds nothing shows nothing", () =>
    expect(decidePill({ moves: [move("NEEDS_CONTEXT", "NEEDS_CONTEXT", false)], probeRuleIds: [], msSinceLastAmber: null }).level).toBe("listening"));
  it("a rule already in review does not turn red again", () =>
    expect(decidePill({ moves: [move("REVIEW_REQUIRED", "REVIEW_REQUIRED")], probeRuleIds: [], msSinceLastAmber: null }).level).toBe("listening"));
  it("a question a rule restricts is amber", () =>
    expect(decidePill({ moves: [], probeRuleIds: ["R1", "R4"], msSinceLastAmber: null })).toMatchObject({ level: "amber", reason: "question_asks_for_restricted", ruleIds: ["R1", "R4"] }));
  it("a second amber inside thirty seconds is held back and says so", () =>
    expect(decidePill({ moves: [], probeRuleIds: ["R1"], msSinceLastAmber: 29999 })).toMatchObject({ level: "listening", reason: "question_asks_for_restricted", suppressed: true }));
  it("an amber at exactly thirty seconds is shown", () =>
    expect(decidePill({ moves: [], probeRuleIds: ["R1"], msSinceLastAmber: 30000 })).toMatchObject({ level: "amber", suppressed: false }));
  it("nothing to say is listening", () =>
    expect(decidePill({ moves: [], probeRuleIds: [], msSinceLastAmber: null })).toEqual({ level: "listening", reason: "none", ruleIds: [], suppressed: false }));
});

describe("endedText", () => {
  it("ended text", () =>
    expect([0, 1, 3].map(endedText)).toEqual(["Call ended. Nothing was hidden.", "Call ended. 1 passage hidden and sent to compliance.", "Call ended. 3 passages hidden and sent to compliance."]));
});
