/**
 * The claim-extraction output schema (§10.2) and the document-facts schema
 * (§11.1), as the model is asked to emit them.
 *
 * Structured outputs cannot express numeric bounds or optional members, so
 * these schemas use nullable members and plain integers; `ground.ts` applies
 * the tighter checks afterwards.
 */
import { z } from "zod";
import { ACCESS_TIMINGS, ENTITY_KINDS, EVENT_KINDS, KNOWLEDGE_BASES, METRIC_CATEGORIES, SCOPES } from "../types";

export const QUOTE_ROLES = ["primary", "context", "correction", "source_attribution"] as const;
export const LINK_KINDS = ["elaborates", "corrects", "attributes_source", "contradicts"] as const;

export const LlmClaimFieldsSchema = z.object({
  summary: z.string(),
  speaker: z.enum(["expert", "analyst"]),
  subject_entity: z.object({ name: z.string().nullable(), kind: z.enum(ENTITY_KINDS) }),
  metric: z.object({ category: z.enum(METRIC_CATEGORIES), label: z.string() }).nullable(),
  event_kind: z.enum(EVENT_KINDS),
  period: z.object({
    label: z.string().nullable(),
    fiscal_year: z.number().int().nullable(),
    fiscal_quarter: z.number().int().nullable(),
    calendar_year: z.number().int().nullable(),
    calendar_quarter: z.number().int().nullable(),
    relative: z.enum(["current", "prior", "future", "unspecified"]),
  }),
  value: z
    .object({
      number: z.number().nullable(),
      unit: z.enum(["percent", "usd", "units"]).nullable(),
      direction: z.enum(["up", "down", "flat"]).nullable(),
      baseline: z.string().nullable(),
    })
    .nullable(),
  scope: z.enum(SCOPES),
  scope_detail: z.string().nullable(),
  knowledge_basis: z.enum(KNOWLEDGE_BASES),
  access_timing: z.enum(ACCESS_TIMINGS),
  confidentiality_signals: z.array(z.string()),
  qualifications: z.array(z.string()),
  is_correction_of: z.string().nullable(),
});
export type LlmClaimFields = z.infer<typeof LlmClaimFieldsSchema>;

export const LlmExtractionSchema = z.object({
  claims: z.array(
    z.object({
      logical_key: z.string(), // "C1"… stable within this run
      fields: LlmClaimFieldsSchema,
      quotes: z.array(
        z.object({
          turn_id: z.string(),
          quote: z.string(),
          role: z.enum(QUOTE_ROLES),
          supports_fields: z.array(z.string()), // e.g. ["knowledge_basis","access_timing"]
        }),
      ),
      links: z.array(z.object({ to: z.string(), kind: z.enum(LINK_KINDS) })),
      solicited_by_analyst: z.enum(["yes", "no", "unclear"]),
      field_uncertainty: z.array(
        z.object({
          field: z.string(),
          // "conflicting_statements": the expert gave two incompatible values for this field.
          kind: z.enum(["ambiguous", "conflicting_statements"]),
          note: z.string(),
        }),
      ),
    }),
  ),
  // Concerns outside the compiled policy; shown labeled "AI suggestion".
  suggested_concerns: z.array(z.object({ title: z.string(), claim_keys: z.array(z.string()), rationale: z.string() })),
  missing_context_questions: z.array(z.object({ claim_key: z.string(), question: z.string() })),
  call_summary: z.string(), // used for baseline mode only
});
export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;

// ── Wire format for the extraction call ─────────────────────────────────────

/**
 * What the model is actually asked to emit. The API compiles an output schema
 * into a grammar, and the nested, nullable shape above compiles to one that is
 * too large to accept. This flat form says the same thing with sentinel values
 * ("" for an absent string, 0 for an absent year or quarter, "none" for an
 * absent category) and one nullable number. `claimFromWire` and
 * `extractionFromWire` restore the canonical shape, so nothing downstream sees
 * the difference.
 */
export const LlmClaimWireSchema = z.object({
  logical_key: z.string(),
  summary: z.string(),
  speaker: z.enum(["expert", "analyst"]),
  subject_kind: z.enum(ENTITY_KINDS),
  subject_name: z.string(),
  metric_category: z.enum([...METRIC_CATEGORIES, "none"]),
  metric_label: z.string(),
  event_kind: z.enum(EVENT_KINDS),
  period_label: z.string(),
  period_relative: z.enum(["current", "prior", "future", "unspecified"]),
  fiscal_year: z.number().int(),
  fiscal_quarter: z.number().int(),
  calendar_year: z.number().int(),
  calendar_quarter: z.number().int(),
  value_number: z.number().nullable(),
  value_unit: z.enum(["percent", "usd", "units", "none"]),
  value_direction: z.enum(["up", "down", "flat", "none"]),
  value_baseline: z.string(),
  scope: z.enum(SCOPES),
  scope_detail: z.string(),
  knowledge_basis: z.enum(KNOWLEDGE_BASES),
  access_timing: z.enum(ACCESS_TIMINGS),
  confidentiality_signals: z.array(z.string()),
  qualifications: z.array(z.string()),
  is_correction_of: z.string(),
  quotes: z.array(z.object({ turn_id: z.string(), quote: z.string(), role: z.enum(QUOTE_ROLES), supports_fields: z.array(z.string()) })),
  links: z.array(z.object({ to: z.string(), kind: z.enum(LINK_KINDS) })),
  solicited_by_analyst: z.enum(["yes", "no", "unclear"]),
  field_uncertainty: z.array(z.object({ field: z.string(), kind: z.enum(["ambiguous", "conflicting_statements"]), note: z.string() })),
});
export type LlmClaimWire = z.infer<typeof LlmClaimWireSchema>;

export const LlmExtractionWireSchema = z.object({
  claims: z.array(LlmClaimWireSchema),
  suggested_concerns: z.array(z.object({ title: z.string(), claim_keys: z.array(z.string()), rationale: z.string() })),
  missing_context_questions: z.array(z.object({ claim_key: z.string(), question: z.string() })),
  call_summary: z.string(),
});
export type LlmExtractionWire = z.infer<typeof LlmExtractionWireSchema>;

const blankToNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const zeroToNull = (n: number): number | null => (n > 0 ? n : null);

/** Restores one claim from the flat wire form. */
export function claimFromWire(c: LlmClaimWire): LlmExtraction["claims"][number] {
  const unit = c.value_unit === "none" ? null : c.value_unit;
  const direction = c.value_direction === "none" ? null : c.value_direction;
  const baseline = blankToNull(c.value_baseline);
  const hasValue = c.value_number !== null || unit !== null || direction !== null || baseline !== null;
  return {
    logical_key: c.logical_key,
    fields: {
      summary: c.summary,
      speaker: c.speaker,
      subject_entity: { name: blankToNull(c.subject_name), kind: c.subject_kind },
      metric: c.metric_category === "none" ? null : { category: c.metric_category, label: c.metric_label.trim() || c.metric_category.replaceAll("_", " ") },
      event_kind: c.event_kind,
      period: {
        label: blankToNull(c.period_label),
        fiscal_year: zeroToNull(c.fiscal_year),
        fiscal_quarter: zeroToNull(c.fiscal_quarter),
        calendar_year: zeroToNull(c.calendar_year),
        calendar_quarter: zeroToNull(c.calendar_quarter),
        relative: c.period_relative,
      },
      value: hasValue ? { number: c.value_number, unit, direction, baseline } : null,
      scope: c.scope,
      scope_detail: blankToNull(c.scope_detail),
      knowledge_basis: c.knowledge_basis,
      access_timing: c.access_timing,
      confidentiality_signals: c.confidentiality_signals,
      qualifications: c.qualifications,
      is_correction_of: blankToNull(c.is_correction_of),
    },
    quotes: c.quotes,
    links: c.links,
    solicited_by_analyst: c.solicited_by_analyst,
    field_uncertainty: c.field_uncertainty,
  };
}

/** Restores the canonical extraction shape from the flat wire form. */
export function extractionFromWire(wire: LlmExtractionWire): LlmExtraction {
  return {
    claims: wire.claims.map(claimFromWire),
    suggested_concerns: wire.suggested_concerns,
    missing_context_questions: wire.missing_context_questions,
    call_summary: wire.call_summary,
  };
}

/** The question the live reader asks about the turn: whether the expert's words state a fact an analyst could act on. */
export const LlmQuestionWireSchema = z.object({
  asks_for_fact: z.boolean(),
  subject_kind: z.enum(ENTITY_KINDS),
  subject_name: z.string(),
  metric_category: z.enum([...METRIC_CATEGORIES, "none"]),
  event_kind: z.enum(EVENT_KINDS),
  period_relative: z.enum(["current", "prior", "future", "unspecified"]),
  scope: z.enum(SCOPES),
});
export type LlmQuestionWire = z.infer<typeof LlmQuestionWireSchema>;

/** What the live reader emits for one turn: the claims it found and the question it answers. */
export const LlmLiveReadWireSchema = z.object({ claims: z.array(LlmClaimWireSchema), question: LlmQuestionWireSchema });
export type LlmLiveReadWire = z.infer<typeof LlmLiveReadWireSchema>;

export const LlmDocFactsSchema = z.object({
  facts: z.array(
    z.object({
      fact_id: z.string(),
      entity: z.string(),
      metric_category: z.enum(METRIC_CATEGORIES).nullable(),
      event_kind: z.enum(EVENT_KINDS),
      period: z.object({ fy: z.number().int(), q: z.number().int().nullable() }).nullable(),
      scope: z.enum(SCOPES),
      value: z
        .object({
          number: z.number().nullable(),
          unit: z.enum(["percent", "usd", "units"]).nullable(),
          direction: z.enum(["up", "down", "flat"]).nullable(),
        })
        .nullable(),
      quote: z.string(),
    }),
  ),
});
export type LlmDocFacts = z.infer<typeof LlmDocFactsSchema>;

export const LlmBriefSchema = z.object({
  sections: z.array(
    z.object({
      heading: z.string(),
      sentences: z.array(z.object({ text: z.string(), claim_ids: z.array(z.string()) })),
    }),
  ),
});
export type LlmBrief = z.infer<typeof LlmBriefSchema>;

// ── Reviewer corrections ────────────────────────────────────────────────────

const QuarterSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/**
 * The fields a reviewer may verify or correct (§10.6, PATCH /api/claims/:id).
 * Each is optional; a present field replaces the asserted value for
 * evaluation (`verified ?? asserted`), and the asserted value is kept.
 */
export const VerifiedFieldsSchema = z
  .strictObject({
    subject_entity: z.strictObject({ name: z.string().trim().min(1).nullable(), kind: z.enum(ENTITY_KINDS) }),
    metric: z.strictObject({ category: z.enum(METRIC_CATEGORIES), label: z.string().trim().min(1) }).nullable(),
    event_kind: z.enum(EVENT_KINDS),
    period: z.strictObject({
      label: z.string().nullable(),
      fiscal_year: z.number().int().min(1990).max(2100).nullable(),
      fiscal_quarter: QuarterSchema.nullable(),
      calendar_year: z.number().int().min(1990).max(2100).nullable(),
      calendar_quarter: QuarterSchema.nullable(),
      relative: z.enum(["current", "prior", "future", "unspecified"]),
    }),
    value: z
      .strictObject({
        number: z.number().finite().nullable(),
        unit: z.enum(["percent", "usd", "units"]).nullable(),
        direction: z.enum(["up", "down", "flat"]).nullable(),
        baseline: z.string().nullable(),
      })
      .nullable(),
    scope: z.enum(SCOPES),
    scope_detail: z.string().nullable(),
    knowledge_basis: z.enum(KNOWLEDGE_BASES),
    access_timing: z.enum(ACCESS_TIMINGS),
    confidentiality_signals: z.array(z.string()),
  })
  .partial();
export type VerifiedFields = z.infer<typeof VerifiedFieldsSchema>;
