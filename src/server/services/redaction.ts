/**
 * What compliance keeps hidden on a case, placed on the current transcript (spec section 5).
 *
 * A passage is hidden when it is a quote of a claim restricted by a decision, or a passage a
 * `live` finding hid that compliance has not cleared. Anything not yet cleared stays hidden: an
 * undecided live flag counts, so the function fails closed even if it is called before review ends.
 * The result feeds both the blanked transcript stored at release and the summary leak check.
 */
import { and, eq } from "drizzle-orm";
import { type HiddenPassage, namePhrases, numbersIn } from "@/core/release/leak";
import type { Span } from "@/core/release/redact";
import { liveFindingCleared } from "@/core/workflow/brief";
import type { DbOrTx } from "../db/client";
import { findings } from "../db/schema";
import { eligibilityForCase, livePassagesForCase } from "./briefs";
import { findingLabel, latestDecision } from "./findingsCore";
import { type LoadedClaim, type TurnRow, currentTranscript, turnsOfVersion } from "./loaders";

export interface RestrictedOnCase {
  spans: Span[];
  passages: HiddenPassage[];
  /** Figures and names that eligible claims state, so repeating them in the summary is not a leak. */
  visible: { numbers: Set<number>; names: Set<string> };
}

interface Source {
  label: string;
  textHash: string;
  start: number;
  end: number;
  /** The words that were hidden, to find them again if the turn's text has changed. */
  text: string;
}

/**
 * Places a passage recorded on some transcript version onto the current one. Same turn text: the
 * offsets stand. Changed text: the hidden words are looked for in the same turn, then in any turn.
 * Not found: the whole turn with that label is hidden, so a correction never reveals what it moved.
 */
function place(source: Source, current: readonly TurnRow[]): { turn: TurnRow; start: number; end: number } | null {
  const same = current.find((t) => t.label === source.label);
  if (same && same.textHash === source.textHash) return { turn: same, start: source.start, end: source.end };
  if (source.text.length > 0) {
    for (const turn of same ? [same, ...current.filter((t) => t !== same)] : current) {
      const at = turn.text.indexOf(source.text);
      if (at >= 0) return { turn, start: at, end: at + source.text.length };
    }
  }
  return same ? { turn: same, start: 0, end: same.text.length } : null;
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
  const transcript = currentTranscript(tx, caseId);
  const current = transcript ? turnsOfVersion(tx, transcript.id) : [];
  const eligibility = eligibilityForCase(tx, caseId);

  const spans: Span[] = [];
  const passages: HiddenPassage[] = [];
  const hide = (findingLbl: string, source: Source, names: readonly string[]) => {
    const placed = place(source, current);
    if (!placed) return;
    const text = placed.turn.text.slice(placed.start, placed.end);
    spans.push({ turnLabel: placed.turn.label, start: placed.start, end: placed.end });
    passages.push({ label: `${findingLbl} · ${placed.turn.label}`, text, numbers: numbersIn(text), names: [...new Set([...names, ...namePhrases(text)])] });
  };

  // Quotes of claims a decision restricted (including claims on a turn a live finding keeps hidden).
  for (const { claim, eligibility: e } of eligibility.claims) {
    if (e.eligible || e.reason !== "restricted") continue;
    for (const q of claim.quotes) {
      hide(e.finding ?? claim.row.logicalKey, { label: q.turnLabel, textHash: q.turnTextHash, start: q.start, end: q.end, text: q.quote }, fieldNames(claim));
    }
  }

  // Passages of live findings compliance has not cleared.
  const live = livePassagesForCase(tx, caseId);
  for (const f of tx.select().from(findings).where(and(eq(findings.caseId, caseId), eq(findings.origin, "live"))).all()) {
    const decision = latestDecision(tx, f.id);
    if (liveFindingCleared({ claimLogicalKey: null, label: findingLabel(f), state: f.state, decision: decision ? { outcome: decision.outcome, stale: decision.stale } : null })) continue;
    for (const p of live.get(f.id) ?? []) {
      hide(findingLabel(f), { label: p.turn.label, textHash: p.turn.textHash, start: p.start, end: p.end, text: p.turn.text.slice(p.start, p.end) }, []);
    }
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
  return { spans, passages, visible: { numbers, names } };
}
