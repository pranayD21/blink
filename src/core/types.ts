/**
 * Core domain types (BLINK_BUILD_SPEC §6.2).
 *
 * Everything under `src/core` is pure: no I/O, no clock, no randomness, no
 * model calls. Time always arrives as an explicit argument.
 */

export type EvidenceState = "supported" | "refuted" | "unknown" | "conflict";
export type Tri = "true" | "false" | "indeterminate";

export const EVIDENCE_STATES: readonly EvidenceState[] = ["supported", "refuted", "unknown", "conflict"];
export const TRI_VALUES: readonly Tri[] = ["true", "false", "indeterminate"];

export const METRIC_CATEGORIES = [
  "orders",
  "bookings",
  "revenue",
  "margin",
  "pricing",
  "inventory",
  "headcount",
  "customer_contract",
  "guidance",
  "capex",
  "input_costs",
  "other",
] as const;
export type MetricCategory = (typeof METRIC_CATEGORIES)[number];

export const KNOWLEDGE_BASES = [
  "internal_system", // dashboards, CRM, ERP
  "internal_document", // decks, memos, board materials
  "insider_conversation", // "my old team told me"
  "personal_observation", // as a customer/distributor
  "public_source", // filings, news, earnings calls
  "industry_survey",
  "speculation",
  "unstated",
] as const;
export type KnowledgeBasis = (typeof KNOWLEDGE_BASES)[number];

export const EVENT_KINDS = [
  "none",
  "contract_change",
  "m_and_a",
  "litigation",
  "regulatory",
  "product",
  "leadership",
  "other",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const SCOPES = [
  "company_wide",
  "segment_or_region",
  "single_customer",
  "industry_aggregate",
  "sample",
  "unspecified",
] as const;
export type Scope = (typeof SCOPES)[number];

export const ENTITY_KINDS = ["issuer", "competitor", "customer", "industry", "unknown"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const ACCESS_TIMINGS = ["during_employment", "after_employment", "unknown", "not_applicable"] as const;
export type AccessTiming = (typeof ACCESS_TIMINGS)[number];

export type Quarter = 1 | 2 | 3 | 4;

export interface ClaimPeriod {
  /** The expert's own words, e.g. "this quarter", "calendar Q3". */
  label: string | null;
  fiscal_year: number | null;
  fiscal_quarter: Quarter | null;
  /**
   * Set only when the expert spoke in calendar terms ("calendar Q3 2026").
   * Kept separate from the fiscal fields so code — not the model — maps a
   * calendar quarter onto the issuer's fiscal calendar (§7.4, fixture V4).
   */
  calendar_year: number | null;
  calendar_quarter: Quarter | null;
  relative: "current" | "prior" | "future" | "unspecified";
}

export interface ClaimValue {
  number: number | null;
  unit: "percent" | "usd" | "units" | null;
  direction: "up" | "down" | "flat" | null;
  baseline: string | null;
}

export interface ClaimFields {
  summary: string; // one sentence, neutral
  speaker: "expert" | "analyst";
  subject_entity: { name: string | null; kind: EntityKind };
  metric: { category: MetricCategory; label: string } | null;
  event_kind: EventKind;
  period: ClaimPeriod;
  value: ClaimValue | null;
  scope: Scope;
  scope_detail: string | null; // e.g. "West region"
  knowledge_basis: KnowledgeBasis;
  access_timing: AccessTiming;
  confidentiality_signals: string[]; // verbatim phrases such as "between us", "not announced"
  qualifications: string[]; // hedges and caveats, verbatim
  is_correction_of: string | null; // logical_key of earlier claim
}

/** Fields whose value drives a predicate. Each can be masked or flagged individually. */
export const EVIDENCE_FIELDS = [
  "subject_entity",
  "metric",
  "event_kind",
  "period",
  "value",
  "scope",
  "knowledge_basis",
  "access_timing",
  "confidentiality_signals",
] as const;
export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

export type QuoteRole = "primary" | "context" | "correction" | "source_attribution";

export interface ClaimQuote {
  /** Display id of the turn in its transcript version, e.g. "T5". */
  turnLabel: string;
  /** 1-based position of the turn in the transcript. */
  turnIdx: number;
  /** Hash of the quoted turn's full text. Content-addresses the quote across versions. */
  turnTextHash: string;
  quote: string;
  start: number;
  end: number;
  role: QuoteRole;
  supportsFields: string[];
  normalized: boolean;
}

export type Solicited = "yes" | "no" | "unclear";

/** Everything predicate evaluation needs to know about one claim. */
export interface ClaimRecord {
  logicalKey: string;
  asserted: ClaimFields;
  /** Reviewer overrides for individual fields; `verified ?? asserted` per field. */
  verified: Partial<ClaimFields> | null;
  quotes: ClaimQuote[];
  solicitedByAnalyst: Solicited;
  /** Fields for which the expert gave conflicting statements (e.g. two sources for one figure). */
  conflictFields: string[];
  /** Fields whose only supporting quote failed validation (§10.3): read as unknown. */
  ungroundedFields: string[];
}

export interface Employment {
  employer: string;
  title: string;
  start: string | null; // ISO date
  end: string | null; // ISO date; null = current
}

export interface ExpertProfile {
  name: string;
  current_employer: string;
  current_title: string;
  employment: Employment[];
  network: string;
  network_attestation: Record<string, unknown>;
}

export interface IssuerFiscal {
  fiscal_year_end_month: number; // 1..12
  fiscal_quarters_note?: string;
  last_reported: { fy: number; q: Quarter; reported_on: string };
  next_report_expected: string | null;
}

export interface CaseContext {
  issuer: string;
  ticker: string;
  aliases: string[];
  fiscal: IssuerFiscal;
  callDate: string; // ISO date
}

export interface FiscalPeriod {
  fy: number;
  q: Quarter | null;
}

export type Severity = "high" | "medium" | "low";
export type Role = "analyst" | "reviewer" | "senior_reviewer" | "policy_owner";

export type DispositionOutcome =
  | "cleared_for_research"
  | "restricted_exclude"
  | "restricted_escalate_to_legal"
  | "no_concern";
