/**
 * Four evidence states → Kleene three-valued logic (§7.1, decision D10).
 *
 * Missing information never silently becomes "no concern": `unknown` and
 * `conflict` both map to `indeterminate`, which a monitor must handle
 * explicitly (validator check INDETERMINATE_UNHANDLED).
 */
import type { EvidenceState, Tri } from "../types";

export function toTri(state: EvidenceState): Tri {
  switch (state) {
    case "supported":
      return "true";
    case "refuted":
      return "false";
    case "unknown":
    case "conflict":
      return "indeterminate";
  }
}

/** false if any input is false; true if all are true; otherwise indeterminate. */
export function and(values: readonly Tri[]): Tri {
  let sawIndeterminate = false;
  for (const v of values) {
    if (v === "false") return "false";
    if (v === "indeterminate") sawIndeterminate = true;
  }
  return sawIndeterminate ? "indeterminate" : "true";
}

/** true if any input is true; false if all are false; otherwise indeterminate. */
export function or(values: readonly Tri[]): Tri {
  let sawIndeterminate = false;
  for (const v of values) {
    if (v === "true") return "true";
    if (v === "indeterminate") sawIndeterminate = true;
  }
  return sawIndeterminate ? "indeterminate" : "false";
}

/** Swaps true and false; indeterminate stays indeterminate. */
export function not(value: Tri): Tri {
  if (value === "true") return "false";
  if (value === "false") return "true";
  return "indeterminate";
}
