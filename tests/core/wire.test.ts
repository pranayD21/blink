/** The flat extraction wire form restores to the canonical shape (see `extractionFromWire`). */
import { describe, expect, it } from "vitest";
import { LlmExtractionSchema, type LlmExtractionWire, LlmExtractionWireSchema, extractionFromWire } from "@/core/extraction/schema";

const claim = (over: Partial<LlmExtractionWire["claims"][number]> = {}): LlmExtractionWire["claims"][number] => ({
  logical_key: "C1",
  summary: "Bookings were down twenty percent.",
  speaker: "expert",
  subject_kind: "issuer",
  subject_name: "Halvorsen",
  metric_category: "bookings",
  metric_label: "Q3 bookings",
  event_kind: "none",
  period_label: "this quarter",
  period_relative: "current",
  fiscal_year: 2027,
  fiscal_quarter: 3,
  calendar_year: 0,
  calendar_quarter: 0,
  value_number: 20,
  value_unit: "percent",
  value_direction: "down",
  value_baseline: "versus last year",
  scope: "segment_or_region",
  scope_detail: "West region",
  knowledge_basis: "internal_system",
  access_timing: "after_employment",
  confidentiality_signals: [],
  qualifications: ["about"],
  is_correction_of: "",
  quotes: [{ turn_id: "T5", quote: "They're down about twenty percent.", role: "primary", supports_fields: ["value"] }],
  links: [],
  solicited_by_analyst: "no",
  field_uncertainty: [],
  ...over,
});
const wire = (...claims: LlmExtractionWire["claims"]): LlmExtractionWire => ({ claims, suggested_concerns: [], missing_context_questions: [], call_summary: "A call." });

describe("extractionFromWire", () => {
  it("restores a fully stated claim, and the result passes the canonical schema", () => {
    const out = extractionFromWire(LlmExtractionWireSchema.parse(wire(claim())));
    expect(LlmExtractionSchema.safeParse(out).success).toBe(true);
    const f = out.claims[0].fields;
    expect(f.subject_entity).toEqual({ name: "Halvorsen", kind: "issuer" });
    expect(f.metric).toEqual({ category: "bookings", label: "Q3 bookings" });
    expect(f.period).toEqual({ label: "this quarter", fiscal_year: 2027, fiscal_quarter: 3, calendar_year: null, calendar_quarter: null, relative: "current" });
    expect(f.value).toEqual({ number: 20, unit: "percent", direction: "down", baseline: "versus last year" });
    expect(f.scope_detail).toBe("West region");
    expect(f.is_correction_of).toBeNull();
  });

  it("turns every sentinel into the absence it stands for", () => {
    const out = extractionFromWire(
      wire(claim({ subject_kind: "unknown", subject_name: "  ", metric_category: "none", metric_label: "", event_kind: "contract_change", period_label: "", period_relative: "unspecified", fiscal_year: 0, fiscal_quarter: 0, value_number: null, value_unit: "none", value_direction: "none", value_baseline: "", scope_detail: "" })),
    );
    const f = out.claims[0].fields;
    expect(f.subject_entity.name).toBeNull();
    expect(f.metric).toBeNull();
    expect(f.value).toBeNull();
    expect(f.period).toEqual({ label: null, fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "unspecified" });
    expect(f.scope_detail).toBeNull();
  });

  it("keeps a qualitative value: a direction with no number is still a value", () => {
    const out = extractionFromWire(wire(claim({ value_number: null, value_unit: "percent", value_direction: "down", value_baseline: "" })));
    expect(out.claims[0].fields.value).toEqual({ number: null, unit: "percent", direction: "down", baseline: null });
  });

  it("carries the correction link and never invents a metric label", () => {
    const out = extractionFromWire(wire(claim(), claim({ logical_key: "C2", is_correction_of: "C1", metric_label: " " })));
    expect(out.claims[1].fields.is_correction_of).toBe("C1");
    expect(out.claims[1].fields.metric).toEqual({ category: "bookings", label: "bookings" });
  });
});
