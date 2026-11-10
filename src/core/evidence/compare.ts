/**
 * Public-evidence comparator (§11.2). Deterministic.
 *
 * Compares a claim with each candidate fact from the curated documents,
 * dimension by dimension. The important results are the rejections: a
 * company-wide Q2 figure does not disclose a region's Q3 figure, and a
 * document published after the call cannot have been the expert's source.
 *
 * "Refuted" here means "not found in the searched set", never "proven
 * non-public". The UI says so.
 */
import { matchesIssuer } from "../predicates/registry";
import type { PublicMatchFact } from "../predicates/registry";
import type { CaseContext, ClaimFields, FiscalPeriod, MetricCategory, Quarter, Scope } from "../types";
import { compareIsoDates, formatFiscalPeriod, resolvePeriod } from "./fiscal";

export interface DocFact {
  fact_id: string;
  entity: string;
  metric_category: MetricCategory | null;
  event_kind: string; // "none" when the fact is a metric
  period: { fy: number; q: Quarter | null } | null;
  scope: Scope;
  value: { number: number | null; unit: "percent" | "usd" | "units" | null; direction: "up" | "down" | "flat" | null } | null;
  quote: string;
  /** Set by a reviewer on the documents page. */
  verified?: boolean;
}

export interface ComparableDocument {
  id: string;
  title: string;
  issuer: string;
  relatedIssuers: string[];
  publishedAt: string;
  sourceType: string;
  facts: DocFact[];
}

export type DimensionVerdict = "match" | "mismatch" | "unknown";
export type DimensionName = "entity" | "metric" | "period" | "scope" | "value" | "published_before_call";

export interface DimensionResult {
  dimension: DimensionName;
  verdict: DimensionVerdict;
  claim: string;
  document: string;
  /** Machine-readable reason on mismatch: "entity" | "metric" | "period" | "scope" | "value" | "PUBLISHED_AFTER_CALL". */
  reason: string | null;
  note: string;
}

export interface CandidateComparison {
  documentId: string;
  documentTitle: string;
  publishedAt: string;
  factId: string;
  factQuote: string;
  factVerified: boolean;
  dimensions: DimensionResult[];
  classification: "exact" | "partial" | "mismatch";
  mismatchReasons: string[];
}

export type ComparisonOutcome = "exact_match" | "partial_match" | "mismatch_only" | "no_candidates";

export interface ComparisonResult {
  outcome: ComparisonOutcome;
  state: PublicMatchFact["state"];
  searchedDocuments: number;
  candidates: CandidateComparison[];
  /** The closest candidate: an exact or partial match if any, else the one with the fewest mismatches. */
  best: CandidateComparison | null;
  /** Mismatch reasons of the closest candidate. */
  reasons: string[];
  summary: string;
}

/** {orders, bookings} are one family; every other category is its own. */
export function metricFamily(category: MetricCategory): string {
  return category === "orders" || category === "bookings" ? "orders_bookings" : category;
}

const SCOPE_LABEL: Record<Scope, string> = {
  company_wide: "company-wide",
  segment_or_region: "segment or region",
  single_customer: "single customer",
  industry_aggregate: "industry aggregate",
  sample: "sample",
  unspecified: "unspecified",
};

function describeValue(v: { number: number | null; unit: string | null; direction: string | null } | null): string {
  if (!v) return "no value";
  const number = v.number === null ? "" : v.unit === "percent" ? `${v.number}%` : v.unit === "usd" ? `$${v.number.toLocaleString("en-US")}` : `${v.number}`;
  return [number, v.direction].filter(Boolean).join(" ") || "no value";
}

/**
 * Should the comparator run for this claim (§10.5)? Only for a claim with a
 * metric or event that is, or may be, about the covered issuer. Industry and
 * competitor statements are not looked up.
 */
export function isComparable(fields: ClaimFields, ctx: CaseContext): boolean {
  if (fields.metric === null && fields.event_kind === "none") return false;
  const { name, kind } = fields.subject_entity;
  if (kind === "industry" || kind === "competitor") return false;
  return !name || matchesIssuer(name, ctx);
}

function isCandidate(fields: ClaimFields, fact: DocFact): boolean {
  if (fields.event_kind !== "none" && fact.event_kind !== "none" && fields.event_kind === fact.event_kind) return true;
  if (fields.metric && fact.metric_category && metricFamily(fields.metric.category) === metricFamily(fact.metric_category)) return true;
  return false;
}

function compareFact(fields: ClaimFields, fact: DocFact, doc: ComparableDocument, ctx: CaseContext): CandidateComparison {
  const dims: DimensionResult[] = [];
  const isEvent = fields.event_kind !== "none" && fact.event_kind === fields.event_kind;

  // entity
  {
    const claimName = fields.subject_entity.name;
    const claimIsIssuer = claimName ? matchesIssuer(claimName, ctx) : false;
    const factIsIssuer = matchesIssuer(fact.entity, ctx);
    let verdict: DimensionVerdict;
    if (!claimName) verdict = "unknown";
    else if (claimIsIssuer) verdict = factIsIssuer ? "match" : "mismatch";
    else verdict = claimName.trim().toLowerCase() === fact.entity.trim().toLowerCase() ? "match" : "mismatch";
    dims.push({
      dimension: "entity",
      verdict,
      claim: claimName ?? "not stated",
      document: fact.entity,
      reason: verdict === "mismatch" ? "entity" : null,
      note: verdict === "mismatch" ? `the document fact is about ${fact.entity}` : "",
    });
  }

  // metric / event
  {
    const claimLabel = isEvent ? fields.event_kind.replaceAll("_", " ") : (fields.metric?.category ?? "none");
    const factLabel = isEvent ? fact.event_kind.replaceAll("_", " ") : (fact.metric_category ?? fact.event_kind);
    dims.push({ dimension: "metric", verdict: "match", claim: claimLabel, document: factLabel, reason: null, note: isEvent ? "same kind of event" : "same metric family" });
  }

  // period
  let periodVerdict: DimensionVerdict;
  {
    const resolved = resolvePeriod(fields.period, ctx.callDate, ctx.fiscal);
    const claimPeriod: FiscalPeriod | null = resolved ? { fy: resolved.fy, q: resolved.q } : null;
    const straddles = (resolved?.spans.length ?? 0) > 1;
    if (!claimPeriod || !fact.period) periodVerdict = "unknown";
    else if (straddles) periodVerdict = resolved!.spans.some((s) => s.fy === fact.period!.fy && s.q === fact.period!.q) ? "unknown" : "mismatch";
    else if (claimPeriod.q === null || fact.period.q === null) periodVerdict = claimPeriod.fy === fact.period.fy ? "unknown" : "mismatch";
    else periodVerdict = claimPeriod.fy === fact.period.fy && claimPeriod.q === fact.period.q ? "match" : "mismatch";
    dims.push({
      dimension: "period",
      verdict: periodVerdict,
      claim: claimPeriod ? formatFiscalPeriod(claimPeriod) : (fields.period.label ?? "not stated"),
      document: fact.period ? formatFiscalPeriod(fact.period) : "not stated",
      reason: periodVerdict === "mismatch" ? "period" : null,
      note: straddles ? resolved!.note : "",
    });
  }

  // scope
  let scopeVerdict: DimensionVerdict;
  {
    if (fields.scope === fact.scope && fields.scope !== "unspecified") scopeVerdict = "match";
    else if (isEvent) scopeVerdict = "unknown"; // an event has no reporting scope to compare
    else if (fields.scope === "unspecified" || fact.scope === "unspecified") scopeVerdict = "unknown";
    else scopeVerdict = "mismatch"; // e.g. a company-wide figure does not disclose a region's figure
    dims.push({
      dimension: "scope",
      verdict: scopeVerdict,
      claim: `${SCOPE_LABEL[fields.scope]}${fields.scope_detail ? ` (${fields.scope_detail})` : ""}`,
      document: SCOPE_LABEL[fact.scope],
      reason: scopeVerdict === "mismatch" ? "scope" : null,
      note: scopeVerdict === "mismatch" ? `a ${SCOPE_LABEL[fact.scope]} figure does not disclose a ${SCOPE_LABEL[fields.scope]} figure` : isEvent && scopeVerdict === "unknown" ? "not applicable to events" : "",
    });
  }

  // value
  {
    const c = fields.value;
    const f = fact.value;
    let verdict: DimensionVerdict = "unknown";
    let note = "";
    if (periodVerdict === "mismatch" || scopeVerdict === "mismatch") {
      note = "not compared: the period or scope differs";
    } else if (!c || !f) {
      note = c || f ? "only one side states a value" : "no value on either side";
    } else if (c.direction && f.direction && c.direction !== f.direction) {
      verdict = "mismatch";
      note = "different direction";
    } else if (c.number !== null && f.number !== null) {
      if (c.unit && f.unit && c.unit !== f.unit) {
        note = "different units";
      } else if ((c.unit ?? f.unit) === "percent") {
        verdict = Math.abs(c.number - f.number) <= 2 ? "match" : "mismatch";
        note = verdict === "match" ? "within ±2 percentage points" : "more than 2 percentage points apart";
      } else {
        const denom = Math.max(Math.abs(c.number), Math.abs(f.number));
        verdict = denom === 0 || Math.abs(c.number - f.number) / denom <= 0.05 ? "match" : "mismatch";
        note = verdict === "match" ? "within ±5%" : "more than 5% apart";
      }
    } else if (c.number === null && c.direction && f.direction) {
      verdict = "match"; // e.g. "high single digits" down vs. 8% down
      note = "same direction; the claim gives no exact number";
    } else {
      note = "not comparable";
    }
    dims.push({ dimension: "value", verdict, claim: describeValue(c), document: describeValue(f), reason: verdict === "mismatch" ? "value" : null, note });
  }

  // published before call
  {
    const before = compareIsoDates(doc.publishedAt, ctx.callDate) < 0;
    dims.push({
      dimension: "published_before_call",
      verdict: before ? "match" : "mismatch",
      claim: `call on ${ctx.callDate}`,
      document: `published ${doc.publishedAt.slice(0, 10)}`,
      reason: before ? null : "PUBLISHED_AFTER_CALL",
      note: before ? "" : "the document was published after the call, so it cannot have been the expert's source",
    });
  }

  const mismatchReasons = dims.filter((d) => d.verdict === "mismatch").map((d) => d.reason!);
  const verdictOf = (name: DimensionName) => dims.find((d) => d.dimension === name)!.verdict;
  let classification: CandidateComparison["classification"];
  if (mismatchReasons.length > 0) classification = "mismatch";
  else if (
    verdictOf("entity") === "match" &&
    verdictOf("metric") === "match" &&
    verdictOf("period") === "match" &&
    (verdictOf("scope") === "match" || isEvent) &&
    verdictOf("published_before_call") === "match"
  )
    classification = "exact";
  else classification = "partial";

  return {
    documentId: doc.id,
    documentTitle: doc.title,
    publishedAt: doc.publishedAt,
    factId: fact.fact_id,
    factQuote: fact.quote,
    factVerified: fact.verified === true,
    dimensions: dims,
    classification,
    mismatchReasons,
  };
}

const DIMENSION_TITLE: Record<DimensionName, string> = {
  entity: "Entity",
  metric: "Metric",
  period: "Period",
  scope: "Scope",
  value: "Value",
  published_before_call: "Published",
};

/** "Period: claim Q3 FY2027 vs document Q2 FY2027; Scope: segment or region (West region) vs company-wide". */
export function describeMismatches(candidate: CandidateComparison): string {
  return candidate.dimensions
    .filter((d) => d.verdict === "mismatch")
    .map((d) =>
      d.dimension === "published_before_call"
        ? `Published after the call: ${d.document} vs ${d.claim}`
        : `${DIMENSION_TITLE[d.dimension]}: claim ${d.claim} vs document ${d.document}`,
    )
    .join("; ");
}

/**
 * Compares one claim with the curated document set.
 *
 * Candidate retrieval: documents whose issuer or related issuers include the
 * case issuer, then facts in the same metric family or with the same event
 * kind. Publication date is deliberately NOT a retrieval filter — it is a
 * comparison dimension, so a post-call document shows up and is rejected
 * with PUBLISHED_AFTER_CALL.
 */
export function compareClaim(fields: ClaimFields, documents: readonly ComparableDocument[], ctx: CaseContext): ComparisonResult {
  const searchedDocuments = documents.length;
  const candidates: CandidateComparison[] = [];
  for (const doc of documents) {
    const relevant = matchesIssuer(doc.issuer, ctx) || doc.relatedIssuers.some((name) => matchesIssuer(name, ctx));
    if (!relevant) continue;
    for (const fact of doc.facts) {
      if (isCandidate(fields, fact)) candidates.push(compareFact(fields, fact, doc, ctx));
    }
  }

  const n = `${searchedDocuments} searched document${searchedDocuments === 1 ? "" : "s"}`;
  if (candidates.length === 0) {
    return {
      outcome: "no_candidates",
      state: "refuted",
      searchedDocuments,
      candidates,
      best: null,
      reasons: [],
      summary: `No match in the ${n} (not proof of nonpublic status)`,
    };
  }

  const exact = candidates.find((c) => c.classification === "exact");
  if (exact) {
    return {
      outcome: "exact_match",
      state: "supported",
      searchedDocuments,
      candidates,
      best: exact,
      reasons: [],
      summary: `Matches "${exact.documentTitle}" (published ${exact.publishedAt.slice(0, 10)}) on entity, metric, period, and scope`,
    };
  }
  const partial = candidates.find((c) => c.classification === "partial");
  if (partial) {
    return {
      outcome: "partial_match",
      state: "unknown",
      searchedDocuments,
      candidates,
      best: partial,
      reasons: [],
      summary: `Proposed match — verify: "${partial.documentTitle}" matches on entity and metric, but other dimensions are unknown`,
    };
  }
  // Closest candidate: one about the right company first, then the fewest mismatches.
  const entityMiss = (c: CandidateComparison) => (c.mismatchReasons.includes("entity") ? 1 : 0);
  const best = [...candidates].sort((a, b) => entityMiss(a) - entityMiss(b) || a.mismatchReasons.length - b.mismatchReasons.length)[0];
  return {
    outcome: "mismatch_only",
    state: "refuted",
    searchedDocuments,
    candidates,
    best,
    reasons: best.mismatchReasons,
    summary: `No match in the ${n} (not proof of nonpublic status). Closest: "${best.documentTitle}" — ${describeMismatches(best)}`,
  };
}

/** The context fact a comparison yields for `public_match_verified`. */
export function toPublicMatchFact(result: ComparisonResult): PublicMatchFact {
  return { state: result.state, outcome: result.outcome, method: "comparator", searchedDocuments: result.searchedDocuments, summary: result.summary };
}
