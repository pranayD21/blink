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
