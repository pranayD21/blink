/**
 * The predicate vocabulary (§7.3).
 *
 * Policy rules may use ONLY the predicates defined here. Each entry is shown
 * to the compiler model (name + description + params) and to the policy
 * owner, and carries a pure `evaluate`. Adding a predicate takes code, tests,
 * and a registry entry: the compiler cannot invent one, and an unknown name
 * fails validation (UNKNOWN_PREDICATE).
 */
import { addMonths, compareIsoDates, isUnreported } from "../evidence/fiscal";
import type {
  CaseContext,
  ClaimFields,
  EvidenceField,
  EvidenceState,
  ExpertProfile,
  KnowledgeBasis,
  MetricCategory,
  Solicited,
} from "../types";

export const PREDICATE_NAMES = [
  "about_covered_issuer",
  "company_specific_operating_metric",
  "nonpublic_corporate_event",
  "current_or_unreported_period",
  "internal_source_claimed",
  "post_employment_access",
  "expert_recent_issuer_employee",
  "confidentiality_signal_present",
  "public_match_verified",
  "analyst_solicited",
] as const;
export type PredicateName = (typeof PREDICATE_NAMES)[number];

export type PredicateParams = Record<string, number | string>;

export interface ParamSpec {
  type: "int";
  min: number;
  max: number;
  description: string;
}

export type EvidenceRef =
  | { kind: "field"; field: string; source: "verified" | "asserted" }
  | { kind: "expert_profile"; detail: string }
  | { kind: "packet"; detail: string }
  | { kind: "comparison"; outcome: string }
  | { kind: "extraction_flag"; detail: string };

export interface PredicateResult {
  state: EvidenceState;
  explanation: string;
  evidenceRefs: EvidenceRef[];
}

/** The comparison fact a claim carries once §11 has run (or a reviewer has ruled). */
export interface PublicMatchFact {
  state: EvidenceState;
  outcome: "exact_match" | "partial_match" | "mismatch_only" | "no_candidates" | "reviewer_verified" | "reviewer_rejected";
  method: "comparator" | "reviewer";
  searchedDocuments: number;
  summary: string;
}

/** What a predicate's `evaluate` may read. Already resolved to `verified ?? asserted`. */
export interface PredicateInput {
  fields: ClaimFields;
  validatedQuoteCount: number;
  solicitedByAnalyst: Solicited;
  caseContext: CaseContext;
  expert: ExpertProfile | null;
  publicMatch: PublicMatchFact | null;
}

export interface PredicateDef {
  name: PredicateName;
  /** English phrase used by the deterministic preview: "the claim is about the covered issuer". */
  phrase: string;
  /** Shown to the compiler model and to the policy owner. */
  description: string;
  params: Record<string, ParamSpec>;
  /**
   * Claim fields this predicate reads. If one is masked (not yet supported at
   * this point in the call), ungrounded, or conflicting, the predicate is
   * unknown / conflict without running `evaluate`.
   */
  inputs: EvidenceField[];
  /** Fields that only mask the predicate (it reads a fact derived from them). */
  derivedFrom?: EvidenceField[];
  /** Asked when the predicate is unknown, to drive a clarification. */
  clarifyQuestion: string;
  evaluate(input: PredicateInput, params: PredicateParams): Omit<PredicateResult, "evidenceRefs"> & { evidenceRefs?: EvidenceRef[] };
}

const OPERATING_METRICS: ReadonlySet<MetricCategory> = new Set<MetricCategory>([
  "orders",
  "bookings",
  "revenue",
  "margin",
  "pricing",
  "inventory",
  "headcount",
  "guidance",
  "capex",
]);

const INTERNAL_BASES: ReadonlySet<KnowledgeBasis> = new Set<KnowledgeBasis>([
  "internal_system",
  "internal_document",
  "insider_conversation",
]);
const EXTERNAL_BASES: ReadonlySet<KnowledgeBasis> = new Set<KnowledgeBasis>([
  "public_source",
  "industry_survey",
  "personal_observation",
]);

/** Lowercase, drop punctuation and corporate suffixes, collapse spaces. */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[‘’']s\b/g, "") // possessive
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|llc|plc|holdings|group)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Case-insensitive, alias-aware match of a company name against the covered issuer. */
export function matchesIssuer(name: string, ctx: Pick<CaseContext, "issuer" | "ticker" | "aliases">): boolean {
  const candidate = normalizeCompanyName(name);
  if (!candidate) return false;
  const known = [ctx.issuer, ctx.ticker, ...ctx.aliases].map(normalizeCompanyName).filter(Boolean);
  return known.includes(candidate);
}

const defs: PredicateDef[] = [
  {
    name: "about_covered_issuer",
    phrase: "the statement is about the covered issuer",
    description:
      "True when the statement is about the specific issuer covered by this case (matched by name or alias). False when it is about a whole industry, a competitor, or another named company. Unknown when the statement does not say which company it concerns.",
    params: {},
    inputs: ["subject_entity"],
    clarifyQuestion: "Which company is this statement about?",
    evaluate({ fields, caseContext }) {
      const { name, kind } = fields.subject_entity;
      if (kind === "industry" || kind === "competitor") {
        return { state: "refuted", explanation: `the statement is about ${kind === "industry" ? "the industry" : `a competitor${name ? ` (${name})` : ""}`}, not ${caseContext.issuer}` };
      }
      if (!name || !name.trim()) {
        return { state: "unknown", explanation: "the statement does not name a company" };
      }
      if (matchesIssuer(name, caseContext)) {
        return { state: "supported", explanation: `"${name}" matches the covered issuer ${caseContext.issuer}` };
      }
      return { state: "refuted", explanation: `"${name}" is a different company from the covered issuer ${caseContext.issuer}` };
    },
  },
  {
    name: "company_specific_operating_metric",
    phrase: "the statement gives an operating figure for one company",
    description:
      "True when the statement gives a company-specific operating result: orders, bookings, revenue, margin, pricing, inventory, headcount, guidance, or capex. False when the figure is an industry aggregate or comes from a sample of companies (this is how the industry-observation exception is expressed), or when the statement is not about an operating result. Unknown when the metric or its scope is unclear, or when a company figure fits none of the metric categories.",
    params: {},
    inputs: ["metric", "scope", "event_kind"],
    clarifyQuestion: "Is this a figure for one company, or an industry-wide or sample observation?",
    evaluate({ fields }) {
      if (fields.scope === "industry_aggregate" || fields.scope === "sample") {
        return { state: "refuted", explanation: `scope is ${fields.scope === "sample" ? "a sample of companies" : "an industry aggregate"}, not one company` };
      }
      if (!fields.metric) {
        if (fields.event_kind !== "none") {
          return { state: "refuted", explanation: "the statement describes an event, not an operating metric" };
        }
        return { state: "unknown", explanation: "no operating metric could be identified" };
      }
      // A figure the categories do not fit may still be an operating result (churn,
      // utilisation, backlog): refuting it would hide it, so a person decides. Industry
      // and sample scopes were refuted above.
      if (fields.metric.category === "other") {
        return { state: "unknown", explanation: `"${fields.metric.label}" fits no known category; a reviewer should say whether it is an operating result` };
      }
      if (!OPERATING_METRICS.has(fields.metric.category)) {
        return { state: "refuted", explanation: `"${fields.metric.label}" (${fields.metric.category}) is not a company operating result` };
      }
      if (fields.scope === "unspecified") {
        return { state: "unknown", explanation: "the scope of the figure (company, region, or industry) is not stated" };
      }
      return { state: "supported", explanation: `${fields.metric.category} at ${fields.scope.replaceAll("_", " ")} scope${fields.scope_detail ? ` (${fields.scope_detail})` : ""}` };
    },
  },
  {
    name: "nonpublic_corporate_event",
    phrase: "the statement describes an unannounced corporate event",
    description:
      "True when the statement describes a corporate event (contract gain or loss, pending transaction, litigation, regulatory action, product or leadership change) and the expert indicated it is not public. False when the statement describes no corporate event. Unknown when an event is described but nothing indicates whether it is public.",
    params: {},
    inputs: ["event_kind", "confidentiality_signals"],
    clarifyQuestion: "Has this event been publicly announced?",
    evaluate({ fields }) {
      if (fields.event_kind === "none") {
        return { state: "refuted", explanation: "the statement describes no corporate event" };
      }
      if (fields.confidentiality_signals.length > 0) {
        return { state: "supported", explanation: `${fields.event_kind.replaceAll("_", " ")} event with the expert's own non-public signal: ${fields.confidentiality_signals.map((s) => `"${s}"`).join(", ")}` };
      }
      return { state: "unknown", explanation: `${fields.event_kind.replaceAll("_", " ")} event described, but nothing says whether it has been announced` };
    },
  },
  {
    name: "current_or_unreported_period",
    phrase: "the statement covers a period the issuer has not yet reported",
    description:
      "True when the statement concerns the issuer's current period or any period after its last reported quarter as of the call date (resolved by code against the issuer's fiscal calendar). False when the period is at or before the last reported quarter. Unknown when no period is stated. Conflict when the expert gave two different periods.",
    params: {},
    inputs: ["period"],
    clarifyQuestion: "Which time period does this statement cover?",
    evaluate({ fields, caseContext }) {
      const check = isUnreported(fields.period, caseContext.fiscal, caseContext.callDate);
      const state: EvidenceState = check.status === "unreported" ? "supported" : check.status === "reported" ? "refuted" : "unknown";
      return { state, explanation: check.explanation, evidenceRefs: [{ kind: "packet", detail: "issuer fiscal calendar and last reported period" }] };
    },
  },
  {
    name: "internal_source_claimed",
    phrase: "the expert credits an internal company source",
    description:
      "True when the expert says the information came from inside the company: its systems (reporting tools, CRM, ERP), its internal documents, or people who work there. False when the expert credits a public source, an industry survey, or their own outside observation. Unknown when the source is not stated or is speculation.",
    params: {},
    inputs: ["knowledge_basis"],
    clarifyQuestion: "How does the expert know this? (internal system or document, a conversation with employees, a public source, or their own observation)",
    evaluate({ fields }) {
      const basis = fields.knowledge_basis;
      if (INTERNAL_BASES.has(basis)) return { state: "supported", explanation: `the expert attributes this to an internal source (${basis.replaceAll("_", " ")})` };
      if (EXTERNAL_BASES.has(basis)) return { state: "refuted", explanation: `the expert attributes this to ${basis.replaceAll("_", " ")}` };
      return { state: "unknown", explanation: basis === "speculation" ? "the expert is speculating; no source given" : "the expert did not say where this comes from" };
    },
  },
  {
    name: "post_employment_access",
    phrase: "the expert accessed the information after their employment ended",
    description:
      "True when the expert says they got the information from a previous employer (its systems, files, or staff) after leaving that job. False when the information dates from while they worked there, or the question does not arise. Unknown when the timing of access is unclear.",
    params: {},
    inputs: ["access_timing"],
    clarifyQuestion: "Did the expert obtain this while still employed there, or after leaving?",
    evaluate({ fields }) {
      switch (fields.access_timing) {
        case "after_employment":
          return { state: "supported", explanation: "the expert describes access after their employment ended" };
        case "during_employment":
          return { state: "refuted", explanation: "the information dates from the expert's employment" };
        case "not_applicable":
          return { state: "refuted", explanation: "no access to an employer's internal information is described" };
        default:
          return { state: "unknown", explanation: "it is unclear when the expert obtained this" };
      }
    },
  },
  {
    name: "expert_recent_issuer_employee",
    phrase: "the expert has worked at the covered issuer in the past {months} months",
    description:
      "From the expert's profile only (never from the transcript). True when the expert worked at the covered issuer and that employment ended within `months` months of the call date, or is current. False when the profile shows no employment at the issuer or it ended earlier. Unknown when dates are missing.",
    params: { months: { type: "int", min: 1, max: 36, description: "look-back window in months before the call date" } },
    inputs: [],
    clarifyQuestion: "When did the expert's employment at the covered issuer end?",
    evaluate({ expert, caseContext }, params) {
      const months = Number(params.months);
      const refs: EvidenceRef[] = [{ kind: "expert_profile", detail: "employment history" }];
      if (!expert) return { state: "unknown", explanation: "no expert profile on file", evidenceRefs: refs };
      const jobs = expert.employment.filter((job) => matchesIssuer(job.employer, caseContext));
      if (jobs.length === 0) {
        return { state: "refuted", explanation: `the expert profile shows no employment at ${caseContext.issuer}`, evidenceRefs: refs };
      }
      let sawUnknown = false;
      for (const job of jobs) {
        if (!job.end) {
          if (job.start) {
            return { state: "supported", explanation: `the profile shows current employment at ${job.employer}`, evidenceRefs: refs };
          }
          sawUnknown = true;
          continue;
        }
        const cutoff = addMonths(job.end, months);
        if (!cutoff) {
          sawUnknown = true;
          continue;
        }
        if (compareIsoDates(cutoff, caseContext.callDate) >= 0) {
          return {
            state: "supported",
            explanation: `employment at ${job.employer} ended ${job.end}, within ${months} months of the call on ${caseContext.callDate}`,
            evidenceRefs: refs,
          };
        }
      }
      if (sawUnknown) return { state: "unknown", explanation: `employment dates at ${caseContext.issuer} are missing from the profile`, evidenceRefs: refs };
      const lastEnd = jobs.map((j) => j.end!).sort().at(-1);
      return { state: "refuted", explanation: `employment at ${caseContext.issuer} ended ${lastEnd}, more than ${months} months before the call on ${caseContext.callDate}`, evidenceRefs: refs };
    },
  },
  {
    name: "confidentiality_signal_present",
    phrase: "the expert marks the information as secret or unreleased",
    description:
      "True when the expert used words signalling confidentiality or non-public status (for example \"off the record\", \"not public until the launch\", \"don't repeat this\"). False when the statement was quoted and carries no such signal. Unknown when the statement could not be grounded in a quote.",
    params: {},
    inputs: ["confidentiality_signals"],
    clarifyQuestion: "Did the expert say this was secret or not yet released?",
    evaluate({ fields, validatedQuoteCount }) {
      if (fields.confidentiality_signals.length > 0) {
        return { state: "supported", explanation: `the expert said ${fields.confidentiality_signals.map((s) => `"${s}"`).join(", ")}` };
      }
      if (validatedQuoteCount >= 1) return { state: "refuted", explanation: "the quoted statement carries no confidentiality signal" };
      return { state: "unknown", explanation: "no validated quote to check for confidentiality signals" };
    },
  },
  {
    name: "public_match_verified",
    phrase: "the information matches a verified public source",
    description:
      "True when the comparator found an exact match in the curated public documents published before the call, or a reviewer verified a public source. False when the searched documents contain only mismatches or no candidate; this means \"not found in the searched set\", never \"proven non-public\". Unknown when no comparison has run or a proposed match is unverified. Use inside not(...) to express a publicly-disclosed exception.",
    params: {},
    inputs: [],
    derivedFrom: ["subject_entity", "metric", "event_kind", "period", "scope"],
    clarifyQuestion: "Is there a public source for this, published before the call?",
    evaluate({ publicMatch }) {
      if (!publicMatch) return { state: "unknown", explanation: "no public-evidence comparison has run for this statement" };
      return { state: publicMatch.state, explanation: publicMatch.summary, evidenceRefs: [{ kind: "comparison", outcome: publicMatch.outcome }] };
    },
  },
  {
    name: "analyst_solicited",
    phrase: "the analyst asked for company-specific non-public detail",
    description:
      "True when the analyst's immediately preceding question asked for company-specific non-public detail. False when the analyst's question was generic. Unknown when this is unclear.",
    params: {},
    inputs: [],
    clarifyQuestion: "Did the analyst's question ask for company-specific non-public detail?",
    evaluate({ solicitedByAnalyst }) {
      const refs: EvidenceRef[] = [{ kind: "extraction_flag", detail: "solicited_by_analyst" }];
      if (solicitedByAnalyst === "yes") return { state: "supported", explanation: "the analyst's prior question asked for company-specific non-public detail", evidenceRefs: refs };
      if (solicitedByAnalyst === "no") return { state: "refuted", explanation: "the analyst's prior question was generic", evidenceRefs: refs };
      return { state: "unknown", explanation: "unclear whether the analyst solicited this", evidenceRefs: refs };
    },
  },
];

export const PREDICATES: ReadonlyMap<string, PredicateDef> = new Map(defs.map((d) => [d.name, d]));

export function getPredicate(name: string): PredicateDef | undefined {
  return PREDICATES.get(name);
}

export function isPredicateName(name: string): name is PredicateName {
  return PREDICATES.has(name);
}

/** Stable key for one predicate use, e.g. `expert_recent_issuer_employee(months=12)`. */
export function predicateKey(name: string, params?: PredicateParams | null): string {
  const entries = Object.entries(params ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (entries.length === 0) return name;
  return `${name}(${entries.map(([k, v]) => `${k}=${v}`).join(",")})`;
}

/** Checks params against the registry's typed specs. Returns a list of problems (empty = valid). */
export function checkParams(name: string, params: PredicateParams | undefined | null): string[] {
  const def = PREDICATES.get(name);
  if (!def) return [`unknown predicate "${name}"`];
  const given = params ?? {};
  const problems: string[] = [];
  for (const key of Object.keys(given)) {
    if (!(key in def.params)) problems.push(`"${name}" takes no param "${key}"`);
  }
  for (const [key, spec] of Object.entries(def.params)) {
    const value = given[key];
    if (value === undefined) {
      problems.push(`"${name}" requires param "${key}"`);
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      problems.push(`"${name}" param "${key}" must be an integer`);
      continue;
    }
    if (value < spec.min || value > spec.max) {
      problems.push(`"${name}" param "${key}" must be between ${spec.min} and ${spec.max} (got ${value})`);
    }
  }
  return problems;
}

/** The registry as shown to the compiler model and on the policy page. */
export function registryForPrompt(): { name: string; description: string; params: Record<string, ParamSpec> }[] {
  return defs.map((d) => ({ name: d.name, description: d.description, params: d.params }));
}

export function predicatePhrase(name: string, params?: PredicateParams | null): string {
  const def = PREDICATES.get(name);
  if (!def) return name;
  return def.phrase.replace(/\{(\w+)\}/g, (_, key: string) => String(params?.[key] ?? `{${key}}`));
}
