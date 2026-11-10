import { describe, expect, it } from "vitest";
import type { LlmQuestionWire } from "@/core/extraction/schema";
import { isTopicPredicate, probeClaim, probeRuleIds } from "@/core/live/probe";
import { PREDICATE_NAMES } from "@/core/predicates/registry";
import { loadHalvorsenContext, loadManualPolicy } from "../helpers/fixtures";

const { ctx, expert } = loadHalvorsenContext();
const policy = loadManualPolicy();
const env = { caseContext: ctx, expert, publicMatch: null };
const q = (over: Partial<LlmQuestionWire> = {}): LlmQuestionWire => ({
  asks_for_fact: true,
  subject_kind: "issuer",
  subject_name: "",
  metric_category: "bookings",
  event_kind: "none",
  period_relative: "current",
  scope: "company_wide",
  ...over,
});

describe("question probe", () => {
  it("a question about the issuer's current bookings hits R1 and R4", () => expect(probeRuleIds(q(), "T10", env, policy).sort()).toEqual(["R1", "R4"]));
  it("an industry question hits nothing", () => expect(probeRuleIds(q({ subject_kind: "industry", scope: "industry_aggregate" }), "T4", env, policy)).toEqual([]));
  it("small talk hits nothing", () => expect(probeRuleIds(q({ asks_for_fact: false }), "T2", env, policy)).toEqual([]));
  it("a rule with no topic predicate is never hit by a question", () => expect(probeRuleIds(q(), "T10", env, policy)).not.toContain("R2"));

  it("names the probe claim by turn, fills the issuer for a blank name, and has no quotes", () => {
    const claim = probeClaim(q(), "T10", ctx)!;
    expect(claim.logicalKey).toBe("probe:T10");
    expect(claim.asserted.subject_entity).toEqual({ name: ctx.issuer, kind: "issuer" });
    expect(claim.asserted.knowledge_basis).toBe("unstated");
    expect(claim.asserted.access_timing).toBe("unknown");
    expect(claim.quotes).toEqual([]);
    expect(claim.solicitedByAnalyst).toBe("yes");
    expect(probeClaim(q({ asks_for_fact: false }), "T2", ctx)).toBeNull();
  });

  it("topic predicates are those reading only subject, metric, event, period and scope", () => {
    expect(PREDICATE_NAMES.filter(isTopicPredicate).sort()).toEqual(["about_covered_issuer", "company_specific_operating_metric", "current_or_unreported_period"]);
    expect(isTopicPredicate("no_such_predicate")).toBe(false);
  });
});
