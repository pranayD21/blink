import { describe, expect, it } from "vitest";
import { NondeterministicMonitorError, evaluateGuard, reduceMonitor, traceLeaves } from "@/core/runtime/monitorReducer";
import type { EvidenceState } from "@/core/types";
import { loadManualPolicy } from "../helpers/fixtures";

const policy = loadManualPolicy();
const m1 = policy.monitors[0];
const g1 = policy.rules.get("R1")!.guard;
const event = { id: "e1", type: "CLAIM_EVALUATED" as const, seq: 1 };
const r1 = (a: EvidenceState, b: EvidenceState, c: EvidenceState) => ({ about_covered_issuer: a, company_specific_operating_metric: b, internal_source_claimed: c });

describe("monitor reducer", () => {
  it("is pure: the same input gives the same output 100 times and nothing is mutated", () => {
    const input = { monitor: m1, guard: g1, state: "UNASSESSED", event, assessments: r1("supported", "supported", "supported") };
    const frozen = JSON.stringify(input);
    const first = JSON.stringify(reduceMonitor(input));
    for (let i = 0; i < 100; i++) expect(JSON.stringify(reduceMonitor(input))).toBe(first);
    expect(JSON.stringify(input)).toBe(frozen);
  });

  it("true → REVIEW_REQUIRED with a review task", () => {
    const out = reduceMonitor({ monitor: m1, guard: g1, state: "UNASSESSED", event, assessments: r1("supported", "supported", "supported") });
    expect(out).toMatchObject({ nextState: "REVIEW_REQUIRED", transitionId: "M1-T1", result: "true", conflictFlag: false });
    expect(out.effects).toContain("OPEN_REVIEW_TASK");
  });

  it("unknown evidence → NEEDS_CONTEXT, never silently 'no concern'", () => {
    const out = reduceMonitor({ monitor: m1, guard: g1, state: "UNASSESSED", event, assessments: r1("supported", "supported", "unknown") });
    expect(out).toMatchObject({ nextState: "NEEDS_CONTEXT", result: "indeterminate" });
    expect(out.effects).toEqual(["OPEN_CONTEXT_TASK"]);
  });

  it("a missing assessment reads as unknown", () => {
    const out = reduceMonitor({ monitor: m1, guard: g1, state: "UNASSESSED", event, assessments: { about_covered_issuer: "supported" } });
    expect(out.result).toBe("indeterminate");
  });

  it("no matching transition → state unchanged, AUDIT_ONLY (never a clearance)", () => {
    const out = reduceMonitor({ monitor: m1, guard: g1, state: "REVIEW_REQUIRED", event, assessments: r1("supported", "refuted", "supported") });
    expect(out).toMatchObject({ nextState: "REVIEW_REQUIRED", transitionId: null, result: "false", effects: ["AUDIT_ONLY"] });
  });

  it("NOT_TRIGGERED is not terminal: later context can move the monitor out of it", () => {
    const out = reduceMonitor({ monitor: m1, guard: g1, state: "NOT_TRIGGERED", event: { ...event, type: "CONTEXT_UPDATED" }, assessments: r1("supported", "supported", "supported") });
    expect(out.nextState).toBe("REVIEW_REQUIRED");
  });

  it("flags a conflict even when the guard evaluates false", () => {
    const out = reduceMonitor({ monitor: m1, guard: g1, state: "UNASSESSED", event, assessments: r1("refuted", "supported", "conflict") });
    expect(out).toMatchObject({ result: "false", nextState: "NOT_TRIGGERED", conflictFlag: true });
  });

  it("records every node's value in the trace", () => {
    const trace = evaluateGuard(policy.rules.get("R4")!.guard, {
      "expert_recent_issuer_employee(months=12)": "supported",
      about_covered_issuer: "supported",
      company_specific_operating_metric: "supported",
      current_or_unreported_period: "supported",
      public_match_verified: "refuted",
    });
    expect(trace.tri).toBe("true");
    expect(traceLeaves(trace).map((l) => [l.key, l.state, l.tri])).toEqual([
      ["expert_recent_issuer_employee(months=12)", "supported", "true"],
      ["about_covered_issuer", "supported", "true"],
      ["company_specific_operating_metric", "supported", "true"],
      ["current_or_unreported_period", "supported", "true"],
      ["public_match_verified", "refuted", "false"],
    ]);
    if (trace.op !== "and") throw new Error("expected and");
    expect(trace.children[4]).toMatchObject({ op: "not", tri: "true" });
  });

  it("a higher priority wins; an equal-priority tie stops instead of guessing", () => {
    const hi = { ...m1, transitions: [...m1.transitions, { ...m1.transitions[0], id: "HI", priority: 9, to: "NOT_TRIGGERED", effects: ["AUDIT_ONLY"] }] };
    expect(reduceMonitor({ monitor: hi, guard: g1, state: "UNASSESSED", event, assessments: r1("supported", "supported", "supported") }).transitionId).toBe("HI");
    const tie = { ...m1, transitions: [...m1.transitions, { ...m1.transitions[0], id: "TIE" }] };
    expect(() => reduceMonitor({ monitor: tie, guard: g1, state: "UNASSESSED", event, assessments: r1("supported", "supported", "supported") })).toThrow(NondeterministicMonitorError);
  });
});
