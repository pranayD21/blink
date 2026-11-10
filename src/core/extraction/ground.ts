/**
 * Grounding of model output against source text (§10.3, §11.1). Deterministic.
 *
 * The model proposes claims with a turn id and a verbatim quote. This module
 * checks every quote character-for-character, computes offsets, and lowers
 * certainty wherever grounding is missing:
 *
 *  - a quote that cannot be found is dropped (QUOTE_NOT_FOUND);
 *  - a claim with no valid primary quote is rejected (CLAIM_UNGROUNDED);
 *  - a field whose only supporting quote was dropped — or was spoken by
 *    someone other than the expert — is reset to its unknown value.
 *
 * Missing grounding never raises certainty.
 */
import { hashOf } from "../deps/hash";
import { locateQuote, validateQuote } from "../evidence/quote";
import type { DocFact } from "../evidence/compare";
import type { ClaimFields, ClaimQuote, EvidenceField, Quarter, QuoteRole, Solicited } from "../types";
import { EVIDENCE_FIELDS } from "../types";
import type { LlmClaimFields, LlmDocFacts, LlmExtraction } from "./schema";

export interface GroundingTurn {
  label: string;
  idx: number;
  speaker: "analyst" | "expert" | "moderator";
  text: string;
  textHash: string;
}

export interface GroundingIssue {
  severity: "blocking" | "warning";
  code: "QUOTE_NOT_FOUND" | "QUOTE_TURN_REASSIGNED" | "CLAIM_UNGROUNDED" | "FIELD_UNGROUNDED" | "LINK_TARGET_MISSING" | "DUPLICATE_CLAIM_KEY" | "REFERENCE_MISSING";
  message: string;
  ref: Record<string, string>;
}

export interface GroundedClaim {
  logicalKey: string;
  fields: ClaimFields;
  quotes: ClaimQuote[];
  links: { to: string; kind: "elaborates" | "corrects" | "attributes_source" | "contradicts" }[];
  solicitedByAnalyst: Solicited;
  fieldUncertainty: { field: string; kind: "ambiguous" | "conflicting_statements"; note: string }[];
  conflictFields: string[];
  ungroundedFields: string[];
}

export interface GroundingResult {
  claims: GroundedClaim[];
  rejected: { logicalKey: string; summary: string; reason: string }[];
  suggestedConcerns: { title: string; claimKeys: string[]; rationale: string }[];
  missingContextQuestions: { claimKey: string; question: string }[];
  callSummary: string;
  issues: GroundingIssue[];
  stats: { proposedClaims: number; groundedClaims: number; proposedQuotes: number; validQuotes: number; normalizedQuotes: number; reassignedQuotes: number; droppedQuotes: number };
}

const isEvidenceField = (f: string): f is EvidenceField => (EVIDENCE_FIELDS as readonly string[]).includes(f);

const asQuarter = (n: number | null): Quarter | null => (n === 1 || n === 2 || n === 3 || n === 4 ? n : null);
const asYear = (n: number | null): number | null => (n !== null && Number.isInteger(n) && n >= 1990 && n <= 2100 ? n : null);

/** Applies the bounds the model-facing schema cannot express. */
export function normalizeFields(raw: LlmClaimFields): ClaimFields {
  return {
    summary: raw.summary.trim(),
    speaker: raw.speaker,
    subject_entity: { name: raw.subject_entity.name?.trim() || null, kind: raw.subject_entity.kind },
    metric: raw.metric ? { category: raw.metric.category, label: raw.metric.label.trim() } : null,
    event_kind: raw.event_kind,
    period: {
      label: raw.period.label?.trim() || null,
      fiscal_year: asYear(raw.period.fiscal_year),
      fiscal_quarter: asQuarter(raw.period.fiscal_quarter),
      calendar_year: asYear(raw.period.calendar_year),
      calendar_quarter: asQuarter(raw.period.calendar_quarter),
      relative: raw.period.relative,
    },
    value: raw.value
      ? { number: raw.value.number !== null && Number.isFinite(raw.value.number) ? raw.value.number : null, unit: raw.value.unit, direction: raw.value.direction, baseline: raw.value.baseline?.trim() || null }
      : null,
    scope: raw.scope,
    scope_detail: raw.scope_detail?.trim() || null,
    knowledge_basis: raw.knowledge_basis,
    access_timing: raw.access_timing,
    confidentiality_signals: raw.confidentiality_signals.map((s) => s.trim()).filter(Boolean),
    qualifications: raw.qualifications.map((s) => s.trim()).filter(Boolean),
    is_correction_of: raw.is_correction_of?.trim() || null,
  };
}

/** Resets one field to the value that means "not established". */
export function resetField(fields: ClaimFields, field: EvidenceField): ClaimFields {
  switch (field) {
    case "subject_entity":
      return { ...fields, subject_entity: { name: null, kind: "unknown" } };
    case "metric":
      return { ...fields, metric: null };
    case "event_kind":
      return { ...fields, event_kind: "none" };
    case "period":
      return { ...fields, period: { label: null, fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "unspecified" } };
    case "value":
      return { ...fields, value: null };
    case "scope":
      return { ...fields, scope: "unspecified", scope_detail: null };
    case "knowledge_basis":
      return { ...fields, knowledge_basis: "unstated" };
    case "access_timing":
      return { ...fields, access_timing: "unknown" };
    case "confidentiality_signals":
      return { ...fields, confidentiality_signals: [] };
  }
}

export function groundExtraction(extraction: LlmExtraction, turns: readonly GroundingTurn[]): GroundingResult {
  const issues: GroundingIssue[] = [];
  const claims: GroundedClaim[] = [];
  const rejected: GroundingResult["rejected"] = [];
  const stats = { proposedClaims: extraction.claims.length, groundedClaims: 0, proposedQuotes: 0, validQuotes: 0, normalizedQuotes: 0, reassignedQuotes: 0, droppedQuotes: 0 };
  const byLabel = new Map(turns.map((t) => [t.label, t]));
  const seenKeys = new Set<string>();

  for (const raw of extraction.claims) {
    const key = raw.logical_key.trim();
    if (!key || seenKeys.has(key)) {
      issues.push({ severity: "warning", code: "DUPLICATE_CLAIM_KEY", message: `the model reused or omitted claim key "${key}"; the later claim was dropped`, ref: { claim: key } });
      continue;
    }
    seenKeys.add(key);

    let fields = normalizeFields(raw.fields);
    const quotes: ClaimQuote[] = [];
    /** field → {proposed support, surviving expert support} */
    const proposedSupport = new Map<string, number>();
    const validSupport = new Map<string, number>();

    for (const q of raw.quotes) {
      stats.proposedQuotes++;
      const wanted = q.supports_fields.filter(isEvidenceField);
      for (const f of wanted) proposedSupport.set(f, (proposedSupport.get(f) ?? 0) + 1);

      const result = validateQuote(q.turn_id.trim(), q.quote, turns);
      if (result.status === "not_found") {
        stats.droppedQuotes++;
        issues.push({ severity: "warning", code: "QUOTE_NOT_FOUND", message: `claim ${key}: quote dropped (${result.reason}): "${q.quote.slice(0, 80)}"`, ref: { claim: key, turn: q.turn_id } });
        continue;
      }
      if (result.status === "reassigned") {
        stats.reassignedQuotes++;
        issues.push({ severity: "warning", code: "QUOTE_TURN_REASSIGNED", message: `claim ${key}: quote was attributed to ${result.reassignedFrom} but appears only in ${result.turnLabel}`, ref: { claim: key, turn: result.turnLabel } });
      }
      const turn = byLabel.get(result.turnLabel)!;
      if (result.match.normalized) stats.normalizedQuotes++;
      stats.validQuotes++;

      // Only the expert's own words can establish a field (§10.2): an analyst's
      // question may be quoted for context but supports nothing.
      const supports = turn.speaker === "expert" ? wanted : [];
      for (const f of supports) validSupport.set(f, (validSupport.get(f) ?? 0) + 1);

      const duplicate = quotes.some((x) => x.turnLabel === turn.label && x.start === result.match.start && x.end === result.match.end && x.role === q.role);
      if (duplicate) continue;
      quotes.push({
        turnLabel: turn.label,
        turnIdx: turn.idx,
        turnTextHash: turn.textHash,
        quote: turn.text.slice(result.match.start, result.match.end),
        start: result.match.start,
        end: result.match.end,
        role: q.role as QuoteRole,
        supportsFields: supports,
        normalized: result.match.normalized,
      });
    }

    const speakerOf = (q: ClaimQuote) => byLabel.get(q.turnLabel)!.speaker;
    const hasPrimary = quotes.some((q) => q.role === "primary" && (fields.speaker !== "expert" || speakerOf(q) === "expert"));
    if (!hasPrimary) {
      rejected.push({ logicalKey: key, summary: fields.summary, reason: "no valid primary quote" });
      issues.push({ severity: "warning", code: "CLAIM_UNGROUNDED", message: `claim ${key} rejected: no valid primary quote ("${fields.summary.slice(0, 80)}")`, ref: { claim: key } });
      continue;
    }

    const ungrounded: string[] = [];
    for (const [field, count] of proposedSupport) {
      if (count > 0 && (validSupport.get(field) ?? 0) === 0 && isEvidenceField(field)) {
        fields = resetField(fields, field);
        ungrounded.push(field);
        issues.push({ severity: "warning", code: "FIELD_UNGROUNDED", message: `claim ${key}: no valid expert quote supports "${field}"; it now reads as unknown`, ref: { claim: key, field } });
      }
    }

    const conflictFields = [...new Set(raw.field_uncertainty.filter((u) => u.kind === "conflicting_statements" && isEvidenceField(u.field)).map((u) => u.field))];
    quotes.sort((a, b) => a.turnIdx - b.turnIdx || a.start - b.start);
    claims.push({
      logicalKey: key,
      fields,
      quotes,
      links: raw.links.map((l) => ({ to: l.to.trim(), kind: l.kind })),
      solicitedByAnalyst: raw.solicited_by_analyst,
      fieldUncertainty: raw.field_uncertainty.map((u) => ({ field: u.field, kind: u.kind, note: u.note })),
      conflictFields,
      ungroundedFields: ungrounded,
    });
  }

  // Links must point at claims that survived grounding. A "corrects" link sets is_correction_of.
  const kept = new Set(claims.map((c) => c.logicalKey));
  for (const claim of claims) {
    claim.links = claim.links.filter((link) => {
      if (kept.has(link.to) && link.to !== claim.logicalKey) return true;
      issues.push({ severity: "warning", code: "LINK_TARGET_MISSING", message: `claim ${claim.logicalKey}: link to ${link.to} dropped (no such grounded claim)`, ref: { claim: claim.logicalKey } });
      return false;
    });
    const corrects = claim.links.find((l) => l.kind === "corrects");
    const target = corrects?.to ?? claim.fields.is_correction_of;
    claim.fields = { ...claim.fields, is_correction_of: target && kept.has(target) && target !== claim.logicalKey ? target : null };
  }

  const suggestedConcerns = extraction.suggested_concerns
    .map((s) => ({ title: s.title.trim(), claimKeys: s.claim_keys.map((k) => k.trim()).filter((k) => kept.has(k)), rationale: s.rationale.trim() }))
    .filter((s) => s.title);
  const missingContextQuestions = extraction.missing_context_questions
    .map((q) => ({ claimKey: q.claim_key.trim(), question: q.question.trim() }))
    .filter((q) => {
      if (kept.has(q.claimKey) && q.question) return true;
      issues.push({ severity: "warning", code: "REFERENCE_MISSING", message: `a missing-context question refers to ${q.claimKey}, which is not a grounded claim`, ref: { claim: q.claimKey } });
      return false;
    });

  stats.groundedClaims = claims.length;
  return { claims, rejected, suggestedConcerns, missingContextQuestions, callSummary: extraction.call_summary.trim(), issues, stats };
}

// ── Document facts (§11.1) ──────────────────────────────────────────────────

export interface DocFactGrounding {
  facts: DocFact[];
  dropped: { fact_id: string; reason: string }[];
}

/** Keeps only facts whose quote appears in the document body, using the same quote algorithm. */
export function groundDocFacts(raw: LlmDocFacts, body: string): DocFactGrounding {
  const facts: DocFact[] = [];
  const dropped: DocFactGrounding["dropped"] = [];
  const seen = new Set<string>();
  for (const f of raw.facts) {
    const match = locateQuote(body, f.quote);
    if (!match) {
      dropped.push({ fact_id: f.fact_id, reason: "quote not found in the document" });
      continue;
    }
    const quote = body.slice(match.start, match.end);
    let factId = f.fact_id.trim() || `F${facts.length + 1}`;
    if (seen.has(factId)) factId = `${factId}-${hashOf(quote).slice(0, 6)}`;
    seen.add(factId);
    facts.push({
      fact_id: factId,
      entity: f.entity.trim(),
      metric_category: f.metric_category,
      event_kind: f.event_kind,
      period: f.period && asYear(f.period.fy) !== null ? { fy: f.period.fy, q: asQuarter(f.period.q) } : null,
      scope: f.scope,
      value: f.value ? { number: f.value.number, unit: f.value.unit, direction: f.value.direction } : null,
      quote,
      verified: false,
    });
  }
  return { facts, dropped };
}
