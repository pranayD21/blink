/**
 * Deterministic predicate evaluation (§7.3).
 *
 * Reads `verified ?? asserted` per field, records which source it used, and
 * applies three generic rules before a predicate's own logic runs:
 *
 *  - a field that is not yet supported by a quote at this point in the call
 *    (turn-ordered evaluation, §9.1) reads as unknown;
 *  - a field whose only supporting quote failed validation (§10.3) reads as
 *    unknown;
 *  - a field for which the expert gave conflicting statements reads as
 *    conflict.
 *
 * A reviewer-verified field overrides all three.
 */
import type { CaseContext, ClaimFields, ClaimRecord, EvidenceField, EvidenceState, ExpertProfile } from "../types";
import { EVIDENCE_FIELDS } from "../types";
import {
  type EvidenceRef,
  type PredicateParams,
  type PredicateResult,
  type PublicMatchFact,
  getPredicate,
  predicateKey,
} from "./registry";

export interface PredicateUse {
  name: string;
  params?: PredicateParams | null;
}

export interface EvaluationEnv {
  caseContext: CaseContext;
  expert: ExpertProfile | null;
  publicMatch: PublicMatchFact | null;
}

/** Which fields are hidden or in conflict for one evaluation. */
export interface EvaluationScope {
  maskedFields: ReadonlySet<string>;
  conflictFields: ReadonlySet<string>;
  /** "T5" when this is a turn-ordered snapshot; null for the full claim. */
  asOfTurnLabel: string | null;
}

export interface Assessment extends PredicateResult {
  key: string;
  name: string;
  params: PredicateParams;
}

export function effectiveFields(claim: Pick<ClaimRecord, "asserted" | "verified">): {
  fields: ClaimFields;
  sources: Record<string, "verified" | "asserted">;
} {
  const fields = { ...claim.asserted } as Record<string, unknown>;
  const sources: Record<string, "verified" | "asserted"> = {};
  for (const key of Object.keys(claim.asserted)) sources[key] = "asserted";
  for (const [key, value] of Object.entries(claim.verified ?? {})) {
    if (value === undefined) continue;
    fields[key] = value;
    sources[key] = "verified";
  }
  return { fields: fields as unknown as ClaimFields, sources };
}

/** A value that means "nothing was said", which no quote can support. */
function isAbsenceDefault(field: EvidenceField, fields: ClaimFields): boolean {
  switch (field) {
    case "subject_entity":
      return fields.subject_entity.name === null && fields.subject_entity.kind === "unknown";
    case "metric":
      return fields.metric === null;
    case "event_kind":
      return fields.event_kind === "none";
    case "period": {
      const p = fields.period;
      return !p.fiscal_year && !p.fiscal_quarter && !p.calendar_year && !p.calendar_quarter && p.relative === "unspecified";
    }
    case "value":
      return fields.value === null;
    case "scope":
      return fields.scope === "unspecified";
    case "knowledge_basis":
      return fields.knowledge_basis === "unstated";
    case "access_timing":
      return fields.access_timing === "unknown" || fields.access_timing === "not_applicable";
    case "confidentiality_signals":
      return fields.confidentiality_signals.length === 0;
  }
}

/** The whole claim: nothing masked. Used for every evaluation after the first analysis. */
export function fullScope(claim: ClaimRecord): EvaluationScope {
  const verified = new Set(Object.keys(claim.verified ?? {}));
  return {
    maskedFields: new Set(),
    conflictFields: new Set(claim.conflictFields.filter((f) => !verified.has(f))),
    asOfTurnLabel: null,
  };
}

/**
 * The claim as it stood after turn `turnIdx`: a field is visible only if a
 * quote in a turn ≤ `turnIdx` supports it. Absence values ("no event",
 * "source unstated") cannot be quoted and are always visible.
 */
export function scopeAtTurn(claim: ClaimRecord, turnIdx: number): EvaluationScope {
  const verified = new Set(Object.keys(claim.verified ?? {}));
  const visible = claim.quotes.filter((q) => q.turnIdx <= turnIdx);
  const supportCount = new Map<string, number>();
  for (const quote of visible) {
    for (const field of quote.supportsFields) supportCount.set(field, (supportCount.get(field) ?? 0) + 1);
  }
  const masked = new Set<string>();
  for (const field of EVIDENCE_FIELDS) {
    if (verified.has(field)) continue;
    if (supportCount.has(field)) continue;
    if (isAbsenceDefault(field, claim.asserted)) continue;
    masked.add(field);
  }
  const conflicts = new Set(
    claim.conflictFields.filter((f) => !verified.has(f) && !masked.has(f) && (supportCount.get(f) ?? 0) >= 2),
  );
  const label = visible.filter((q) => q.turnIdx === turnIdx)[0]?.turnLabel ?? null;
  return { maskedFields: masked, conflictFields: conflicts, asOfTurnLabel: label };
}

/** The turns at which a claim gains a quote, in order. One CLAIM_EVALUATED event is emitted per entry (§9.1). */
export function quoteTurns(claim: ClaimRecord): { turnIdx: number; turnLabel: string }[] {
  const seen = new Map<number, string>();
  for (const q of claim.quotes) if (!seen.has(q.turnIdx)) seen.set(q.turnIdx, q.turnLabel);
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([turnIdx, turnLabel]) => ({ turnIdx, turnLabel }));
}

export function evaluatePredicate(use: PredicateUse, claim: ClaimRecord, env: EvaluationEnv, scope: EvaluationScope): Assessment {
  const params = use.params ?? {};
  const key = predicateKey(use.name, params);
  const def = getPredicate(use.name);
  if (!def) {
    // The validator rejects unknown predicates before activation; fail closed if one slips through.
    return { key, name: use.name, params, state: "unknown", explanation: `unknown predicate "${use.name}"`, evidenceRefs: [] };
  }

  const { fields, sources } = effectiveFields(claim);
  const refs: EvidenceRef[] = def.inputs.map((field) => ({ kind: "field", field, source: sources[field] ?? "asserted" }));
  const at = scope.asOfTurnLabel ? ` as of ${scope.asOfTurnLabel}` : "";
  const done = (state: EvidenceState, explanation: string, extra: EvidenceRef[] = []): Assessment => ({
    key,
    name: use.name,
    params,
    state,
    explanation,
    evidenceRefs: [...refs, ...extra],
  });

  const readsOrDerives = [...def.inputs, ...(def.derivedFrom ?? [])];
  const masked = readsOrDerives.filter((f) => scope.maskedFields.has(f));
  if (masked.length > 0) {
    return done("unknown", `not yet stated${at}: ${masked.map((f) => f.replaceAll("_", " ")).join(", ")}`);
  }
  const ungrounded = def.inputs.filter((f) => sources[f] !== "verified" && claim.ungroundedFields.includes(f));
  if (ungrounded.length > 0) {
    return done("unknown", `no validated quote supports: ${ungrounded.map((f) => f.replaceAll("_", " ")).join(", ")}`);
  }
  const conflicting = def.inputs.filter((f) => scope.conflictFields.has(f));
  if (conflicting.length > 0) {
    return done("conflict", `the expert gave conflicting statements about: ${conflicting.map((f) => f.replaceAll("_", " ")).join(", ")}`);
  }

  const result = def.evaluate(
    {
      fields,
      validatedQuoteCount: claim.quotes.length,
      solicitedByAnalyst: claim.solicitedByAnalyst,
      caseContext: env.caseContext,
      expert: env.expert,
      publicMatch: env.publicMatch,
    },
    params,
  );
  return done(result.state, result.explanation, result.evidenceRefs ?? []);
}

/** Evaluates a set of predicate uses once each, keyed by `predicateKey`. */
export function assessClaim(
  uses: readonly PredicateUse[],
  claim: ClaimRecord,
  env: EvaluationEnv,
  scope: EvaluationScope,
): Record<string, Assessment> {
  const out: Record<string, Assessment> = {};
  for (const use of uses) {
    const key = predicateKey(use.name, use.params);
    if (!out[key]) out[key] = evaluatePredicate(use, claim, env, scope);
  }
  return out;
}

export function statesOf(assessments: Record<string, Assessment>): Record<string, EvidenceState> {
  return Object.fromEntries(Object.entries(assessments).map(([k, a]) => [k, a.state]));
}
