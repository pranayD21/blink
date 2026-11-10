/**
 * What compliance keeps hidden on a case, placed on the current transcript (spec section 5).
 *
 * A passage is hidden when it is a quote of a claim that has any finding not cleared (rejected claims
 * included: a claim retired by a corrected transcript can no longer be cited, but what it quoted is
 * still restricted), or a passage a `live` finding hid that compliance has not cleared. "Cleared" is
 * `findingCleared`: DISPOSITIONED cleared_for_research or no_concern on a decision that still stands.
 * Passages are mapped onto the current transcript through turn lineage (`placement.ts`). One that
 * cannot be placed is listed in `unplaced` so the release refuses rather than dropping it.
 * The result feeds both the blanked transcript stored at release and the summary leak check.
 */
import { type HiddenPassage, namePhrases, numbersIn } from "@/core/release/leak";
import type { Span } from "@/core/release/redact";
import { findingCleared, hiddenBy } from "@/core/workflow/brief";
import type { DbOrTx } from "../db/client";
import { eligibilityForCase } from "./briefs";
import type { LoadedClaim } from "./loaders";
import { turnPlacer } from "./placement";

export interface RestrictedOnCase {
  spans: Span[];
  passages: HiddenPassage[];
  /** Figures and names that eligible claims state, so repeating them in the summary is not a leak. */
  visible: { numbers: Set<number>; names: Set<string> };
  /** Labels ("F1 · T5") of hidden passages that could not be placed on the current transcript. */
  unplaced: string[];
}

/** Every string and number in a claim's fields, for the visible set. */
function leaves(value: unknown, strings: string[], numbers: number[]): void {
  if (typeof value === "string") strings.push(value);
  else if (typeof value === "number" && Number.isFinite(value)) numbers.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, strings, numbers);
  else if (value && typeof value === "object") for (const v of Object.values(value)) leaves(v, strings, numbers);
}

/** The names a claim's fields state: who it is about and the narrower scope (a customer, a region). */
function fieldNames(claim: LoadedClaim): string[] {
  return [claim.fields.subject_entity?.name, claim.fields.scope_detail].filter((n): n is string => typeof n === "string" && n.trim().length > 0);
}

export function restrictedOnCase(tx: DbOrTx, caseId: string): RestrictedOnCase {
  const placer = turnPlacer(tx, caseId);
  const eligibility = eligibilityForCase(tx, caseId, placer);

  const spans: Span[] = [];
  const passages: HiddenPassage[] = [];
  const unplaced: string[] = [];
  const passage = (label: string, text: string, names: readonly string[]) => passages.push({ label, text, numbers: numbersIn(text), names: [...new Set([...names, ...namePhrases(text)])] });
  const hide = (findingLbl: string, turnId: string, start: number, end: number, names: readonly string[]) => {
    const placed = placer.place(turnId, start, end);
    if (!placed) {
      const label = `${findingLbl} · ${placer.sourceLabel(turnId)}`;
      if (!unplaced.includes(label)) unplaced.push(label);
      return;
    }
    for (const p of placed) {
      spans.push({ turnLabel: p.turn.label, start: p.start, end: p.end });
      passage(`${findingLbl} · ${p.turn.label}`, p.turn.text.slice(p.start, p.end), names);
    }
    // When the text moved or changed, the summary must not repeat the words as they were hidden either.
    const original = placer.sourceText(turnId, start, end);
    if (original !== null && !placed.some((p) => p.turn.text.slice(p.start, p.end) === original)) passage(`${findingLbl} · ${placed[0].turn.label}`, original, names);
  };

  // Quotes of every claim, rejected or not, that a finding not yet cleared keeps hidden.
  for (const { claim, turnLabels } of eligibility.claims) {
    const by = hiddenBy({ logicalKey: claim.row.logicalKey, status: claim.row.status, turnLabels }, eligibility.findings);
    if (!by) continue;
    for (const q of claim.quotes) hide(by, q.turnId, q.start, q.end, fieldNames(claim));
  }

  // Passages of live findings compliance has not cleared.
  for (const f of eligibility.findings) {
    if (f.origin !== "live" || findingCleared(f)) continue;
    for (const p of f.passages) hide(f.label, p.turnId, p.start, p.end, []);
  }

  const numbers = new Set<number>();
  const names = new Set<string>();
  for (const claim of eligibility.eligible) {
    const strings: string[] = claim.quotes.map((q) => q.quote);
    const values: number[] = [];
    leaves(claim.fields, strings, values);
    for (const n of values) numbers.add(n);
    for (const text of strings) {
      for (const n of numbersIn(text)) numbers.add(n);
      for (const name of namePhrases(text)) names.add(name);
    }
    for (const name of fieldNames(claim)) names.add(name);
  }
  return { spans, passages, visible: { numbers, names }, unplaced };
}
