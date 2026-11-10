import { describe, expect, it } from "vitest";
import { groundDocFacts, groundExtraction } from "@/core/extraction/ground";
import { type LlmExtraction, LlmExtractionSchema } from "@/core/extraction/schema";
import { readFixture, readJson, turnsOf } from "../helpers/fixtures";

const turns = turnsOf(
  ["Analyst (Priya): What are you seeing on demand?", "Expert (R): Orders fell twenty percent.", "Analyst (Priya): At Halvorsen this quarter?", "Expert (R): No, across our distributor sample last year. I saw it in the survey."].join("\n"),
);

type RawClaim = LlmExtraction["claims"][number];
const fields = (over: Partial<RawClaim["fields"]> = {}): RawClaim["fields"] => ({
  summary: "Orders fell twenty percent.",
  speaker: "expert",
  subject_entity: { name: "Halvorsen", kind: "issuer" },
  metric: { category: "orders", label: "orders" },
  event_kind: "none",
  period: { label: "this quarter", fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "current" },
  value: { number: 20, unit: "percent", direction: "down", baseline: null },
  scope: "company_wide",
  scope_detail: null,
  knowledge_basis: "industry_survey",
  access_timing: "not_applicable",
  confidentiality_signals: [],
  qualifications: [],
  is_correction_of: null,
  ...over,
});
const rawClaim = (key: string, quotes: RawClaim["quotes"], over: Partial<RawClaim> = {}): RawClaim => ({ logical_key: key, fields: fields(), quotes, links: [], solicited_by_analyst: "no", field_uncertainty: [], ...over });
const extraction = (claims: RawClaim[], over: Partial<LlmExtraction> = {}): LlmExtraction => ({ claims, suggested_concerns: [], missing_context_questions: [], call_summary: "s", ...over });

describe("grounding (§10.3)", () => {
  it("keeps a verbatim quote with computed offsets", () => {
    const out = groundExtraction(extraction([rawClaim("C1", [{ turn_id: "T2", quote: "Orders fell twenty percent.", role: "primary", supports_fields: ["metric", "value"] }], { fields: fields({ subject_entity: { name: null, kind: "unknown" }, scope: "unspecified", knowledge_basis: "unstated" }) })]), turns);
    expect(out.claims).toHaveLength(1);
    expect(out.claims[0].quotes[0]).toMatchObject({ turnLabel: "T2", turnIdx: 2, start: 0, end: 27, role: "primary", normalized: false, supportsFields: ["metric", "value"] });
    expect(out.stats).toMatchObject({ proposedQuotes: 1, validQuotes: 1, droppedQuotes: 0, groundedClaims: 1 });
    expect(out.issues).toEqual([]);
  });

  it("rejects a claim with no valid primary quote (CLAIM_UNGROUNDED)", () => {
    const out = groundExtraction(extraction([rawClaim("C1", [{ turn_id: "T2", quote: "Orders collapsed by half.", role: "primary", supports_fields: ["metric"] }])]), turns);
    expect(out.claims).toEqual([]);
    expect(out.rejected).toEqual([{ logicalKey: "C1", summary: "Orders fell twenty percent.", reason: "no valid primary quote" }]);
    expect(out.issues.map((i) => i.code)).toEqual(["QUOTE_NOT_FOUND", "CLAIM_UNGROUNDED"]);
    expect(out.stats.droppedQuotes).toBe(1);
  });

  it("does not attribute the analyst's suggestion to the expert (V3)", () => {
    // The model filled company and period from the analyst's question and cited the analyst's turn.
    const out = groundExtraction(
      extraction([
        rawClaim("C1", [
          { turn_id: "T2", quote: "Orders fell twenty percent.", role: "primary", supports_fields: ["metric", "value"] },
          { turn_id: "T3", quote: "At Halvorsen this quarter?", role: "context", supports_fields: ["subject_entity", "period"] },
        ]),
      ]),
      turns,
    );
    const claim = out.claims[0];
    expect(claim.fields.subject_entity).toEqual({ name: null, kind: "unknown" });
    expect(claim.fields.period.relative).toBe("unspecified");
    expect(claim.ungroundedFields.sort()).toEqual(["period", "subject_entity"]);
    // The analyst's words are kept as context but support nothing.
    expect(claim.quotes.find((q) => q.turnLabel === "T3")).toMatchObject({ role: "context", supportsFields: [] });
    expect(out.issues.filter((i) => i.code === "FIELD_UNGROUNDED")).toHaveLength(2);
  });

  it("resets a field whose only supporting quote was dropped, lowering certainty", () => {
    const out = groundExtraction(
      extraction([
        rawClaim("C1", [
          { turn_id: "T2", quote: "Orders fell twenty percent.", role: "primary", supports_fields: ["metric", "value"] },
          { turn_id: "T4", quote: "I pulled it from their Salesforce dashboard.", role: "source_attribution", supports_fields: ["knowledge_basis"] },
        ], { fields: fields({ knowledge_basis: "internal_system" }) }),
      ]),
      turns,
    );
    expect(out.claims[0].fields.knowledge_basis).toBe("unstated");
    expect(out.claims[0].ungroundedFields).toEqual(["knowledge_basis"]);
  });

  it("reattaches a quote attributed to the wrong turn and records it", () => {
    const out = groundExtraction(extraction([rawClaim("C1", [{ turn_id: "T2", quote: "No, across our distributor sample last year.", role: "primary", supports_fields: ["scope"] }])]), turns);
    expect(out.claims[0].quotes[0].turnLabel).toBe("T4");
    expect(out.issues.map((i) => i.code)).toEqual(["QUOTE_TURN_REASSIGNED"]);
    expect(out.stats.reassignedQuotes).toBe(1);
  });

  it("records conflicting statements as conflict fields and normalizes out-of-range numbers", () => {
    const out = groundExtraction(
      extraction([
        rawClaim("C1", [{ turn_id: "T2", quote: "Orders fell twenty percent.", role: "primary", supports_fields: ["metric"] }], {
          fields: fields({ period: { label: "Q7", fiscal_year: 27, fiscal_quarter: 7, calendar_year: null, calendar_quarter: 0, relative: "current" } }),
          field_uncertainty: [{ field: "knowledge_basis", kind: "conflicting_statements", note: "two sources" }, { field: "scope", kind: "ambiguous", note: "unclear" }, { field: "summary", kind: "conflicting_statements", note: "not an evidence field" }],
        }),
      ]),
      turns,
    );
    expect(out.claims[0].conflictFields).toEqual(["knowledge_basis"]);
    expect(out.claims[0].fields.period).toMatchObject({ fiscal_year: null, fiscal_quarter: null, calendar_quarter: null });
  });

  it("drops links to claims that did not survive and sets is_correction_of from a corrects link", () => {
    const out = groundExtraction(
      extraction([
        rawClaim("C1", [{ turn_id: "T2", quote: "Orders fell twenty percent.", role: "primary", supports_fields: ["metric"] }]),
        rawClaim("C2", [{ turn_id: "T4", quote: "No, across our distributor sample last year.", role: "primary", supports_fields: ["scope"] }], { links: [{ to: "C1", kind: "corrects" }, { to: "C9", kind: "elaborates" }] }),
      ], { missing_context_questions: [{ claim_key: "C1", question: "Which company?" }, { claim_key: "C9", question: "?" }], suggested_concerns: [{ title: "Pattern", claim_keys: ["C1", "C9"], rationale: "r" }] }),
      turns,
    );
    expect(out.claims[1].links).toEqual([{ to: "C1", kind: "corrects" }]);
    expect(out.claims[1].fields.is_correction_of).toBe("C1");
    expect(out.claims[0].fields.is_correction_of).toBeNull();
    expect(out.missingContextQuestions).toEqual([{ claimKey: "C1", question: "Which company?" }]);
    expect(out.suggestedConcerns).toEqual([{ title: "Pattern", claimKeys: ["C1"], rationale: "r" }]);
    expect(out.issues.map((i) => i.code).sort()).toEqual(["LINK_TARGET_MISSING", "REFERENCE_MISSING"]);
  });

  it("drops a duplicate claim key instead of merging", () => {
    const q = [{ turn_id: "T2", quote: "Orders fell twenty percent.", role: "primary" as const, supports_fields: [] }];
    const out = groundExtraction(extraction([rawClaim("C1", q), rawClaim("C1", q)]), turns);
    expect(out.claims).toHaveLength(1);
    expect(out.issues.map((i) => i.code)).toEqual(["DUPLICATE_CLAIM_KEY"]);
  });

  it("the hand-labeled gold extraction grounds cleanly: every quote resolves", () => {
    const gold = readJson<{ extraction: unknown }>("cases", "halvorsen", "gold.json");
    const v1 = turnsOf(readFixture("cases", "halvorsen", "transcript-v1.txt"));
    const out = groundExtraction(LlmExtractionSchema.parse(gold.extraction), v1);
    expect(out.issues).toEqual([]);
    expect(out.claims).toHaveLength(10);
    expect(out.stats).toMatchObject({ proposedQuotes: 14, validQuotes: 14, droppedQuotes: 0, normalizedQuotes: 0 });
    expect(out.claims[0].quotes.map((q) => q.turnLabel)).toEqual(["T5", "T11", "T11", "T11"]);
  });
});

describe("document fact grounding (§11.1)", () => {
  const body = "For the second quarter of fiscal 2027, total company orders decreased 8% compared with the prior-year period.";
  const fact = (quote: string, id = "F1") => ({ fact_id: id, entity: "Halvorsen Pumps, Inc.", metric_category: "orders" as const, event_kind: "none" as const, period: { fy: 2027, q: 2 }, scope: "company_wide" as const, value: { number: 8, unit: "percent" as const, direction: "down" as const }, quote });

  it("keeps facts whose quote is in the body and drops the rest", () => {
    const out = groundDocFacts({ facts: [fact("total company orders decreased 8%"), fact("orders rose 30%", "F2")] }, body);
    expect(out.facts.map((f) => f.fact_id)).toEqual(["F1"]);
    expect(out.facts[0]).toMatchObject({ quote: "total company orders decreased 8%", verified: false, period: { fy: 2027, q: 2 } });
    expect(out.dropped).toEqual([{ fact_id: "F2", reason: "quote not found in the document" }]);
  });

  it("keeps fact ids unique", () => {
    const out = groundDocFacts({ facts: [fact("total company orders decreased 8%"), fact("compared with the prior-year period")] }, body);
    expect(new Set(out.facts.map((f) => f.fact_id)).size).toBe(2);
  });
});
