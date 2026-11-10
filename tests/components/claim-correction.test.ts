/** Reviewer corrections for the period and the figure, which the form used to leave read-only. */
import { describe, expect, it } from "vitest";
import { buildClaimCorrection } from "@/components/workspace/claim-correction";
import type { ClaimFields } from "@/core/types";

function fields(over: Partial<ClaimFields> = {}): ClaimFields {
  return {
    summary: "Orders fell twenty percent this quarter.",
    speaker: "expert",
    subject_entity: { name: "Northwind", kind: "issuer" },
    metric: { category: "orders", label: "orders" },
    event_kind: "none",
    period: { label: "this quarter", fiscal_year: 2027, fiscal_quarter: 3, calendar_year: null, calendar_quarter: null, relative: "current" },
    value: { number: 20, unit: "percent", direction: "down", baseline: "last year" },
    scope: "company_wide",
    scope_detail: null,
    knowledge_basis: "public_source",
    access_timing: "unknown",
    confidentiality_signals: [],
    qualifications: [],
    is_correction_of: null,
    ...over,
  };
}

const asserted = fields();

describe("buildClaimCorrection", () => {
  it("leaves a claim alone when nothing was changed", () => {
    const result = buildClaimCorrection(asserted, asserted, null, { period: "current", fiscal_year: "2027", fiscal_quarter: "3", value_number: "20", value_unit: "percent", value_direction: "down" });
    expect(result).toEqual({ ok: true, verified: {}, clear: [] });
  });

  it("corrects the fiscal quarter and year and keeps the rest of the period", () => {
    const result = buildClaimCorrection(asserted, asserted, null, { fiscal_year: "2026", fiscal_quarter: "2" });
    expect(result.ok && result.verified.period).toEqual({ ...asserted.period, fiscal_year: 2026, fiscal_quarter: 2 });
    expect(result.ok && result.clear).toEqual([]);
  });

  it("clears a fiscal year the reviewer blanks out", () => {
    const result = buildClaimCorrection(asserted, asserted, null, { fiscal_year: "" });
    expect(result.ok && result.verified.period?.fiscal_year).toBeNull();
    expect(result.ok && result.verified.period?.fiscal_quarter).toBe(3);
  });

  it("rejects a year that is not four digits", () => {
    const result = buildClaimCorrection(asserted, asserted, null, { fiscal_year: "27" });
    expect(!result.ok && result.error).toMatch(/four-digit/);
  });

  it("corrects the figure and keeps its baseline", () => {
    const result = buildClaimCorrection(asserted, asserted, null, { value_number: "15", value_direction: "down", value_unit: "percent" });
    expect(result.ok && result.verified.value).toEqual({ number: 15, unit: "percent", direction: "down", baseline: "last year" });
  });

  it("rejects a figure that is not a number", () => {
    const result = buildClaimCorrection(asserted, asserted, null, { value_number: "fifteen" });
    expect(!result.ok && result.error).toMatch(/number/);
  });

  it("withdraws a verified figure when the reviewer goes back to the expert", () => {
    const effective = fields({ value: { number: 15, unit: "percent", direction: "down", baseline: "last year" } });
    const result = buildClaimCorrection(effective, asserted, { value: effective.value }, { value: "__asserted__" });
    expect(result.ok && result.verified).toEqual({});
    expect(result.ok && result.clear).toEqual(["value"]);
  });

  it("withdraws a verified period when the edit lands back on what the expert said", () => {
    const effective = fields({ period: { ...asserted.period, fiscal_year: 2026 } });
    const result = buildClaimCorrection(effective, asserted, { period: effective.period }, { fiscal_year: "2027" });
    expect(result.ok && result.verified).toEqual({});
    expect(result.ok && result.clear).toEqual(["period"]);
  });

  it("still corrects an enumerated field", () => {
    const result = buildClaimCorrection(asserted, asserted, null, { knowledge_basis: "internal_system" });
    expect(result.ok && result.verified).toEqual({ knowledge_basis: "internal_system" });
  });
});
