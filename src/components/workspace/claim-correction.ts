/**
 * Turns the claim-field form into the patch `PATCH /api/claims/:id` already accepts.
 * A field the reviewer did not change is left out. "__asserted__" withdraws a
 * verified override and returns to what the expert said.
 */
import type { VerifiedFields } from "@/core/extraction/schema";
import type { ClaimFields, ClaimPeriod, ClaimValue, Quarter } from "@/core/types";

export type CorrectionDraft = Record<string, string>;

export type CorrectionResult = { ok: true; verified: VerifiedFields; clear: string[] } | { ok: false; error: string };

const ENUM_FIELDS = ["subject_entity", "event_kind", "scope", "knowledge_basis", "access_timing"] as const;

function samePeriod(a: ClaimPeriod, b: ClaimPeriod): boolean {
  return a.relative === b.relative && a.fiscal_year === b.fiscal_year && a.fiscal_quarter === b.fiscal_quarter && a.calendar_year === b.calendar_year && a.calendar_quarter === b.calendar_quarter && a.label === b.label;
}

function sameValue(a: ClaimValue | null, b: ClaimValue | null): boolean {
  if (a === null || b === null) return a === b;
  return a.number === b.number && a.unit === b.unit && a.direction === b.direction && a.baseline === b.baseline;
}

function parseYear(raw: string): { year: number | null } | { ok: false; error: string } {
  const text = raw.trim();
  if (text === "") return { year: null };
  if (!/^\d{4}$/.test(text)) return { ok: false as const, error: "Fiscal year has to be a four-digit year, or empty." };
  const year = Number(text);
  if (year < 1990 || year > 2100) return { ok: false as const, error: "Fiscal year has to be between 1990 and 2100." };
  return { year };
}

function parseQuarter(raw: string): { quarter: Quarter | null } | { ok: false; error: string } {
  if (raw === "") return { quarter: null };
  if (raw !== "1" && raw !== "2" && raw !== "3" && raw !== "4") return { ok: false as const, error: "Fiscal quarter has to be Q1 to Q4, or empty." };
  return { quarter: Number(raw) as Quarter };
}

function parseNumber(raw: string): { number: number | null } | { ok: false; error: string } {
  const text = raw.trim();
  if (text === "") return { number: null };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false as const, error: "The figure has to be a number, or empty." };
  const number = Number(text);
  if (!Number.isFinite(number)) return { ok: false as const, error: "The figure has to be a number, or empty." };
  return { number };
}

function periodFrom(fields: ClaimFields, draft: CorrectionDraft): { period: ClaimPeriod } | { ok: false; error: string } {
  const relative = (draft.period ?? fields.period.relative) as ClaimPeriod["relative"];
  const year = draft.fiscal_year === undefined ? { year: fields.period.fiscal_year } : parseYear(draft.fiscal_year);
  if ("ok" in year) return year;
  const quarter = draft.fiscal_quarter === undefined ? { quarter: fields.period.fiscal_quarter } : parseQuarter(draft.fiscal_quarter);
  if ("ok" in quarter) return quarter;
  return { period: { ...fields.period, relative, fiscal_year: year.year, fiscal_quarter: quarter.quarter } };
}

function valueFrom(fields: ClaimFields, draft: CorrectionDraft): { value: ClaimValue | null } | { ok: false; error: string } {
  const base = fields.value;
  const number = draft.value_number === undefined ? { number: base?.number ?? null } : parseNumber(draft.value_number);
  if ("ok" in number) return number;
  const unitRaw = draft.value_unit === undefined ? (base?.unit ?? "") : draft.value_unit;
  const directionRaw = draft.value_direction === undefined ? (base?.direction ?? "") : draft.value_direction;
  const unit = (unitRaw === "" ? null : unitRaw) as ClaimValue["unit"];
  const direction = (directionRaw === "" ? null : directionRaw) as ClaimValue["direction"];
  const baseline = base?.baseline ?? null;
  if (number.number === null && unit === null && direction === null && baseline === null) return { value: null };
  return { value: { number: number.number, unit, direction, baseline } };
}

function enumValue(fields: ClaimFields, field: (typeof ENUM_FIELDS)[number]): string {
  return field === "subject_entity" ? fields.subject_entity.kind : fields[field];
}

/** The verified patch and the fields to withdraw. `fields` is the effective claim (verified over asserted). */
export function buildClaimCorrection(fields: ClaimFields, asserted: ClaimFields, verified: Partial<ClaimFields> | null, draft: CorrectionDraft): CorrectionResult {
  const present = verified ?? {};
  const patch: VerifiedFields = {};
  const clear: string[] = [];

  for (const field of ENUM_FIELDS) {
    const next = draft[field];
    if (next === undefined) continue;
    if (next === "__asserted__") {
      if (field in present) clear.push(field);
      continue;
    }
    if (next === enumValue(fields, field)) continue;
    if (field in present && next === enumValue(asserted, field)) {
      clear.push(field);
      continue;
    }
    if (field === "subject_entity") patch.subject_entity = { name: fields.subject_entity.name, kind: next as ClaimFields["subject_entity"]["kind"] };
    else Object.assign(patch, { [field]: next });
  }

  if (draft.period === "__asserted__") {
    if ("period" in present) clear.push("period");
  } else if (draft.period !== undefined || draft.fiscal_year !== undefined || draft.fiscal_quarter !== undefined) {
    const built = periodFrom(fields, draft);
    if ("ok" in built) return built;
    if (!samePeriod(built.period, fields.period)) {
      if ("period" in present && samePeriod(built.period, asserted.period)) clear.push("period");
      else patch.period = built.period;
    }
  }

  if (draft.value === "__asserted__") {
    if ("value" in present) clear.push("value");
  } else if (draft.value_number !== undefined || draft.value_unit !== undefined || draft.value_direction !== undefined) {
    const built = valueFrom(fields, draft);
    if ("ok" in built) return built;
    if (!sameValue(built.value, fields.value)) {
      if ("value" in present && sameValue(built.value, asserted.value)) clear.push("value");
      else patch.value = built.value;
    }
  }

  return { ok: true, verified: patch, clear };
}
