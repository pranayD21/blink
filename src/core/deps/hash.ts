/**
 * Canonical JSON and SHA-256 (§12.1).
 *
 * Every approval, decision, and audit event in Blink is bound to a hash of
 * the evidence it was based on, so the encoding has to be stable: object keys
 * are sorted, there is no whitespace, and `undefined` members are dropped.
 */
import { createHash } from "node:crypto";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: non-finite number ${value}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record)
        .filter((k) => record[k] !== undefined)
        .sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

/** Locale-independent ordering, so hashes do not depend on the machine's ICU data. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function hashOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Short display form used in the UI ("Decided on evidence #a41f…"). */
export function shortHash(hash: string, length = 8): string {
  return hash.slice(0, length);
}

// ── Domain hashes (§12.1) ───────────────────────────────────────────────────

export function turnHash(text: string): string {
  return sha256Hex(text);
}

export interface ClaimHashInput {
  fields: unknown;
  verified: unknown;
  quotes: { turnTextHash: string; start: number; end: number; role: string }[];
}

/**
 * claim: `fields` + `verified` + sorted quotes. Quotes are identified by the
 * hash of the turn they sit in plus their offsets, so a claim carried into a
 * corrected transcript keeps its hash when — and only when — the text it
 * quotes is unchanged.
 */
export function claimHash(input: ClaimHashInput): string {
  const quotes = input.quotes
    .map((q) => ({ t: q.turnTextHash, s: q.start, e: q.end, r: q.role }))
    .sort((a, b) => compareStrings(a.t, b.t) || a.s - b.s || a.e - b.e || compareStrings(a.r, b.r));
  return hashOf({ fields: input.fields, verified: input.verified ?? null, quotes });
}

export function contextFactHash(key: string, value: unknown, evidenceState: string): string {
  return hashOf({ key, value, evidenceState });
}

export function documentHash(bodyHash: string, verifiedFactIds: string[]): string {
  return hashOf({ bodyHash, verified: [...verifiedFactIds].sort() });
}

export interface BriefSentence {
  text: string;
  claim_ids: string[];
}
export interface BriefSection {
  heading: string;
  sentences: BriefSentence[];
}

export function briefHash(bodyMd: string, sections: BriefSection[]): string {
  return hashOf({ bodyMd, sections });
}

export interface DependencyEdge {
  sourceType: string;
  sourceId: string;
  sourceHash: string;
}

/** `decisions.evidence_hash`: hash of the sorted (source_type, source_id, source_hash) list. */
export function evidenceHash(edges: DependencyEdge[]): string {
  const sorted = edges
    .map((e) => [e.sourceType, e.sourceId, e.sourceHash] as const)
    .sort((a, b) => compareStrings(a.join("\u0000"), b.join("\u0000")));
  return hashOf(sorted);
}
