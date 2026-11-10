import { describe, expect, it } from "vitest";
import { type EvaluationEnv, assessClaim, effectiveFields, evaluatePredicate, fullScope, quoteTurns, scopeAtTurn } from "@/core/predicates/evaluate";
import { PREDICATE_NAMES, checkParams, matchesIssuer, predicateKey } from "@/core/predicates/registry";
import type { PublicMatchFact } from "@/core/predicates/registry";
import type { ClaimFields, ClaimQuote, ClaimRecord, EvidenceState, ExpertProfile } from "@/core/types";
import { loadHalvorsenContext } from "../helpers/fixtures";

const { ctx, expert } = loadHalvorsenContext();
const env = (publicMatch: PublicMatchFact | null = null, e: ExpertProfile | null = expert): EvaluationEnv => ({ caseContext: ctx, expert: e, publicMatch });

const baseFields: ClaimFields = {
  summary: "s",
  speaker: "expert",
  subject_entity: { name: "Halvorsen", kind: "issuer" },
  metric: { category: "bookings", label: "bookings" },
  event_kind: "none",
  period: { label: "Q3", fiscal_year: 2027, fiscal_quarter: 3, calendar_year: null, calendar_quarter: null, relative: "current" },
  value: { number: 20, unit: "percent", direction: "down", baseline: null },
  scope: "segment_or_region",
  scope_detail: "West region",
  knowledge_basis: "internal_system",
  access_timing: "after_employment",
  confidentiality_signals: [],
  qualifications: [],
  is_correction_of: null,
};
const quote = (turnIdx: number, supportsFields: string[]): ClaimQuote => ({ turnLabel: `T${turnIdx}`, turnIdx, turnTextHash: `h${turnIdx}`, quote: "q", start: 0, end: 1, role: "primary", supportsFields, normalized: false });
const claim = (fields: Partial<ClaimFields> = {}, extra: Partial<ClaimRecord> = {}): ClaimRecord => ({
  logicalKey: "C1",
  asserted: { ...baseFields, ...fields },
  verified: null,
  quotes: [quote(5, ["metric", "value"])],
  solicitedByAnalyst: "unclear",
  conflictFields: [],
  ungroundedFields: [],
  ...extra,
});
const state = (name: string, c: ClaimRecord, e = env(), params?: Record<string, number>): EvidenceState => evaluatePredicate({ name, params }, c, e, fullScope(c)).state;

describe("predicate registry", () => {
  it("has exactly the ten predicates of §7.3", () => {
    expect([...PREDICATE_NAMES].sort()).toEqual(
      ["about_covered_issuer", "analyst_solicited", "company_specific_operating_metric", "confidentiality_signal_present", "current_or_unreported_period", "expert_recent_issuer_employee", "internal_source_claimed", "nonpublic_corporate_event", "post_employment_access", "public_match_verified"].sort(),
    );
  });

  it("builds stable keys and checks typed params", () => {
    expect(predicateKey("about_covered_issuer")).toBe("about_covered_issuer");
    expect(predicateKey("expert_recent_issuer_employee", { months: 12 })).toBe("expert_recent_issuer_employee(months=12)");
    expect(checkParams("expert_recent_issuer_employee", { months: 12 })).toEqual([]);
    expect(checkParams("expert_recent_issuer_employee", {})).toHaveLength(1);
    expect(checkParams("expert_recent_issuer_employee", { months: 0 })).toHaveLength(1);
    expect(checkParams("expert_recent_issuer_employee", { months: 37 })).toHaveLength(1);
    expect(checkParams("expert_recent_issuer_employee", { months: 1.5 })).toHaveLength(1);
    expect(checkParams("about_covered_issuer", { months: 3 })).toHaveLength(1);
  });

  it("matches issuer aliases case-insensitively", () => {
    for (const name of ["Halvorsen", "halvorsen pumps", "HLVP", "Halvorsen Pumps, Inc.", "Halvorsen's"]) expect(matchesIssuer(name, ctx)).toBe(true);
    for (const name of ["Brightwater", "Halvorsen Marine", ""]) expect(matchesIssuer(name, ctx)).toBe(false);
  });
});

describe("about_covered_issuer", () => {
  it("supported for the issuer or an alias", () => expect(state("about_covered_issuer", claim())).toBe("supported"));
  it("refuted for industry, competitor, or another named company", () => {
    expect(state("about_covered_issuer", claim({ subject_entity: { name: null, kind: "industry" } }))).toBe("refuted");
    expect(state("about_covered_issuer", claim({ subject_entity: { name: "Brightwater", kind: "competitor" } }))).toBe("refuted");
    expect(state("about_covered_issuer", claim({ subject_entity: { name: "Cardinal Utilities", kind: "customer" } }))).toBe("refuted");
  });
  it("unknown when no company is named", () => expect(state("about_covered_issuer", claim({ subject_entity: { name: null, kind: "unknown" } }))).toBe("unknown"));
  it("conflict when the expert named two companies", () => expect(state("about_covered_issuer", claim({}, { conflictFields: ["subject_entity"] }))).toBe("conflict"));
});

describe("company_specific_operating_metric", () => {
  it("supported for an operating metric at company or segment scope", () => {
    expect(state("company_specific_operating_metric", claim())).toBe("supported");
    expect(state("company_specific_operating_metric", claim({ scope: "company_wide", metric: { category: "margin", label: "m" } }))).toBe("supported");
  });
  it("refuted for an industry aggregate or a sample (the P6 exception)", () => {
    expect(state("company_specific_operating_metric", claim({ scope: "industry_aggregate" }))).toBe("refuted");
    expect(state("company_specific_operating_metric", claim({ scope: "sample" }))).toBe("refuted");
  });
  it("refuted for a non-operating metric or a pure event", () => {
    expect(state("company_specific_operating_metric", claim({ metric: { category: "input_costs", label: "steel" } }))).toBe("refuted");
    expect(state("company_specific_operating_metric", claim({ metric: null, event_kind: "contract_change" }))).toBe("refuted");
  });
  it("unknown when the metric is missing or the scope is unspecified", () => {
    expect(state("company_specific_operating_metric", claim({ metric: null }))).toBe("unknown");
    expect(state("company_specific_operating_metric", claim({ scope: "unspecified" }))).toBe("unknown");
  });
  it("an uncategorised company figure is unknown, never refuted", () => {
    expect(state("company_specific_operating_metric", claim({ metric: { category: "other", label: "customer churn" }, scope: "company_wide" }))).toBe("unknown");
  });
  it.each(["company_wide", "segment_or_region", "single_customer", "unspecified"] as const)("an uncategorised figure at %s scope is unknown", (scope) => {
    expect(state("company_specific_operating_metric", claim({ metric: { category: "other", label: "customer churn" }, scope }))).toBe("unknown");
  });
  it("an uncategorised industry-wide figure is still refuted", () => {
    expect(state("company_specific_operating_metric", claim({ metric: { category: "other", label: "customer churn" }, scope: "industry_aggregate" }))).toBe("refuted");
  });
  it("conflict when the scope statements conflict", () => expect(state("company_specific_operating_metric", claim({}, { conflictFields: ["scope"] }))).toBe("conflict"));
});

describe("nonpublic_corporate_event", () => {
  it("supported for an event with a non-public signal", () => expect(state("nonpublic_corporate_event", claim({ event_kind: "contract_change", confidentiality_signals: ["not announced"] }))).toBe("supported"));
  it("refuted when there is no event", () => expect(state("nonpublic_corporate_event", claim())).toBe("refuted"));
  it("unknown for an event with no signal either way", () => expect(state("nonpublic_corporate_event", claim({ event_kind: "product" }))).toBe("unknown"));
  it("conflict when signals conflict", () => expect(state("nonpublic_corporate_event", claim({ event_kind: "product" }, { conflictFields: ["confidentiality_signals"] }))).toBe("conflict"));
});

describe("current_or_unreported_period", () => {
  it("supported after the last reported period", () => expect(state("current_or_unreported_period", claim())).toBe("supported"));
  it("refuted at or before it", () => {
    expect(state("current_or_unreported_period", claim({ period: { ...baseFields.period, fiscal_quarter: 2, relative: "prior" } }))).toBe("refuted");
    expect(state("current_or_unreported_period", claim({ period: { label: "well before I left", fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "prior" } }))).toBe("refuted");
  });
  it("unknown when no period is given", () =>
    expect(state("current_or_unreported_period", claim({ period: { label: null, fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "unspecified" } }))).toBe("unknown"));
  it("conflict when two quotes give different periods", () => expect(state("current_or_unreported_period", claim({}, { conflictFields: ["period"] }))).toBe("conflict"));
  it("fiscal Q3 FY2027 vs calendar Q3 2026 (V4)", () => {
    const calendar = (cq: 2 | 3) => claim({ period: { label: `calendar Q${cq}`, fiscal_year: null, fiscal_quarter: null, calendar_year: 2026, calendar_quarter: cq, relative: "prior" } });
    expect(state("current_or_unreported_period", calendar(3))).toBe("supported");
    expect(state("current_or_unreported_period", calendar(2))).toBe("refuted");
  });
});

describe("internal_source_claimed", () => {
  it.each(["internal_system", "internal_document", "insider_conversation"] as const)("supported for %s", (b) => expect(state("internal_source_claimed", claim({ knowledge_basis: b }))).toBe("supported"));
  it.each(["public_source", "industry_survey", "personal_observation"] as const)("refuted for %s", (b) => expect(state("internal_source_claimed", claim({ knowledge_basis: b }))).toBe("refuted"));
  it.each(["speculation", "unstated"] as const)("unknown for %s", (b) => expect(state("internal_source_claimed", claim({ knowledge_basis: b }))).toBe("unknown"));
  it("conflict for two incompatible sources (V6)", () => expect(state("internal_source_claimed", claim({}, { conflictFields: ["knowledge_basis"] }))).toBe("conflict"));
});

describe("post_employment_access", () => {
  it("supported after employment", () => expect(state("post_employment_access", claim())).toBe("supported"));
  it("refuted during employment or when not applicable", () => {
    expect(state("post_employment_access", claim({ access_timing: "during_employment" }))).toBe("refuted");
    expect(state("post_employment_access", claim({ access_timing: "not_applicable" }))).toBe("refuted");
  });
  it("unknown otherwise", () => expect(state("post_employment_access", claim({ access_timing: "unknown" }))).toBe("unknown"));
  it("conflict when timing statements conflict", () => expect(state("post_employment_access", claim({}, { conflictFields: ["access_timing"] }))).toBe("conflict"));
});

describe("expert_recent_issuer_employee", () => {
  const months = { months: 12 };
  const withJob = (end: string | null, start: string | null = "2019-03-01"): ExpertProfile => ({ ...expert, employment: [{ employer: "Halvorsen Pumps, Inc.", title: "t", start, end }] });
  it("supported when employment ended within the window (profile only)", () => expect(state("expert_recent_issuer_employee", claim(), env(), months)).toBe("supported"));
  it("supported for current employment", () => expect(state("expert_recent_issuer_employee", claim(), env(null, withJob(null)), months)).toBe("supported"));
  it("refuted when the expert left 14 months ago", () => expect(state("expert_recent_issuer_employee", claim(), env(null, withJob("2025-09-02")), months)).toBe("refuted"));
  it("refuted when never employed at the issuer", () =>
    expect(state("expert_recent_issuer_employee", claim(), env(null, { ...expert, employment: [{ employer: "Brightwater Flow Systems", title: "t", start: "2014-06-01", end: "2019-02-15" }] }), months)).toBe("refuted"));
  it("unknown when dates are missing or there is no profile", () => {
    expect(state("expert_recent_issuer_employee", claim(), env(null, withJob(null, null)), months)).toBe("unknown");
    expect(state("expert_recent_issuer_employee", claim(), env(null, null), months)).toBe("unknown");
  });
  it("respects the window boundary", () => {
    expect(state("expert_recent_issuer_employee", claim(), env(null, withJob("2025-11-03")), months)).toBe("supported");
    expect(state("expert_recent_issuer_employee", claim(), env(null, withJob("2025-11-02")), months)).toBe("refuted");
  });
  it("ignores what the transcript says about the claim", () =>
    expect(state("expert_recent_issuer_employee", claim({}, { conflictFields: ["subject_entity", "period"], ungroundedFields: ["knowledge_basis"] }), env(), months)).toBe("supported"));
});

describe("confidentiality_signal_present", () => {
  it("supported with a signal", () => expect(state("confidentiality_signal_present", claim({ confidentiality_signals: ["between us"] }))).toBe("supported"));
  it("refuted when quoted with no signal", () => expect(state("confidentiality_signal_present", claim())).toBe("refuted"));
  it("unknown with no validated quote", () => expect(state("confidentiality_signal_present", claim({}, { quotes: [] }))).toBe("unknown"));
  it("conflict when flagged", () => expect(state("confidentiality_signal_present", claim({}, { conflictFields: ["confidentiality_signals"] }))).toBe("conflict"));
});

describe("public_match_verified", () => {
  const fact = (s: EvidenceState, outcome: PublicMatchFact["outcome"]): PublicMatchFact => ({ state: s, outcome, method: "comparator", searchedDocuments: 6, summary: "x" });
  it("supported on an exact or reviewer-verified match", () => {
    expect(state("public_match_verified", claim(), env(fact("supported", "exact_match")))).toBe("supported");
    expect(state("public_match_verified", claim(), env({ ...fact("supported", "reviewer_verified"), method: "reviewer" }))).toBe("supported");
  });
  it("refuted when only mismatches or nothing was found", () => {
    expect(state("public_match_verified", claim(), env(fact("refuted", "mismatch_only")))).toBe("refuted");
    expect(state("public_match_verified", claim(), env(fact("refuted", "no_candidates")))).toBe("refuted");
  });
  it("unknown when no comparison ran or a match is only proposed", () => {
    expect(state("public_match_verified", claim(), env(null))).toBe("unknown");
    expect(state("public_match_verified", claim(), env(fact("unknown", "partial_match")))).toBe("unknown");
  });
  it("conflict when the comparison fact is in conflict", () => expect(state("public_match_verified", claim(), env(fact("conflict", "partial_match")))).toBe("conflict"));
});

describe("analyst_solicited", () => {
  it("maps the extraction flag", () => {
    expect(state("analyst_solicited", claim({}, { solicitedByAnalyst: "yes" }))).toBe("supported");
    expect(state("analyst_solicited", claim({}, { solicitedByAnalyst: "no" }))).toBe("refuted");
    expect(state("analyst_solicited", claim({}, { solicitedByAnalyst: "unclear" }))).toBe("unknown");
  });
});

describe("evaluation rules shared by all predicates", () => {
  it("a reviewer-verified field overrides the asserted one and is recorded as the source", () => {
    const c = claim({ knowledge_basis: "unstated" }, { verified: { knowledge_basis: "public_source" } });
    const a = evaluatePredicate({ name: "internal_source_claimed" }, c, env(), fullScope(c));
    expect(a.state).toBe("refuted");
    expect(a.evidenceRefs).toContainEqual({ kind: "field", field: "knowledge_basis", source: "verified" });
    expect(effectiveFields(c).sources.knowledge_basis).toBe("verified");
    expect(effectiveFields(c).sources.metric).toBe("asserted");
  });

  it("a verified field clears a conflict and an ungrounded flag", () => {
    const c = claim({}, { conflictFields: ["knowledge_basis"], ungroundedFields: ["knowledge_basis"], verified: { knowledge_basis: "insider_conversation" } });
    expect(state("internal_source_claimed", c)).toBe("supported");
  });

  it("a field whose supporting quote was dropped reads as unknown", () => {
    expect(state("internal_source_claimed", claim({}, { ungroundedFields: ["knowledge_basis"] }))).toBe("unknown");
  });

  it("an unknown predicate name fails closed as unknown", () => {
    expect(state("expert_is_lying", claim())).toBe("unknown");
  });

  it("turn-ordered scope hides fields that later turns support (G1 at T5)", () => {
    const c = claim(
      {},
      {
        quotes: [quote(5, ["metric", "value"]), quote(11, ["subject_entity", "scope", "period", "knowledge_basis", "access_timing"])],
      },
    );
    expect(quoteTurns(c)).toEqual([{ turnIdx: 5, turnLabel: "T5" }, { turnIdx: 11, turnLabel: "T11" }]);
    const atT5 = scopeAtTurn(c, 5);
    expect([...atT5.maskedFields].sort()).toEqual(["access_timing", "knowledge_basis", "period", "scope", "subject_entity"]);
    const early = assessClaim([{ name: "about_covered_issuer" }, { name: "company_specific_operating_metric" }, { name: "internal_source_claimed" }, { name: "nonpublic_corporate_event" }], c, env(), atT5);
    expect(early.about_covered_issuer.state).toBe("unknown");
    expect(early.company_specific_operating_metric.state).toBe("unknown");
    expect(early.internal_source_claimed.state).toBe("unknown");
    // "No event" is an absence, which no quote can support: it is visible from the start.
    expect(early.nonpublic_corporate_event.state).toBe("refuted");
    const late = assessClaim([{ name: "about_covered_issuer" }, { name: "internal_source_claimed" }], c, env(), scopeAtTurn(c, 11));
    expect(late.about_covered_issuer.state).toBe("supported");
    expect(late.internal_source_claimed.state).toBe("supported");
  });

  it("a conflict needs both conflicting quotes to be visible", () => {
    const c = claim({}, { conflictFields: ["knowledge_basis"], quotes: [quote(2, ["metric", "knowledge_basis"]), quote(4, ["knowledge_basis"])] });
    expect(scopeAtTurn(c, 2).conflictFields.has("knowledge_basis")).toBe(false);
    expect(scopeAtTurn(c, 4).conflictFields.has("knowledge_basis")).toBe(true);
  });
});
