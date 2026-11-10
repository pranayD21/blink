/** View helpers for the review workspace. Pure; shared by its panes. */
import type { ClaimView, FindingView, WorkspacePayload } from "@/server/services/workspace";

export type Selection = { kind: "finding"; id: string } | { kind: "claim"; key: string } | null;

export const isOpen = (f: FindingView) => f.state !== "DISPOSITIONED";

/** The finding that decides how a claim's highlights are colored: an open one first, policy before AI. */
export function leadFinding(findings: FindingView[], claimKey: string): FindingView | null {
  const mine = findings.filter((f) => f.claimLogicalKey === claimKey);
  if (mine.length === 0) return null;
  const rank = (f: FindingView) => (isOpen(f) ? 0 : 2) + (f.origin === "policy" ? 0 : 1);
  return [...mine].sort((a, b) => rank(a) - rank(b))[0];
}

export interface TurnSpan {
  start: number;
  end: number;
  claimKey: string;
  role: string;
}

/** Non-overlapping highlight spans for one turn, earliest first. Where two quotes overlap, the earlier one wins. */
export function spansForTurn(claims: ClaimView[], turnLabel: string): TurnSpan[] {
  const raw: TurnSpan[] = [];
  for (const claim of claims) {
    if (claim.status === "rejected") continue;
    for (const q of claim.quotes) if (q.turnLabel === turnLabel) raw.push({ start: q.start, end: q.end, claimKey: claim.logicalKey, role: q.role });
  }
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: TurnSpan[] = [];
  let cursor = 0;
  for (const span of raw) {
    const start = Math.max(span.start, cursor);
    if (start >= span.end) continue;
    out.push({ ...span, start });
    cursor = span.end;
  }
  return out;
}

export function scrollToTurn(label: string) {
  const el = document.getElementById(`turn-${label}`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("flash-once");
  // Restart the animation even when the same turn is clicked twice.
  void el.offsetWidth;
  el.classList.add("flash-once");
}

export const claimOf = (payload: WorkspacePayload, key: string | null) => (key ? (payload.claims.find((c) => c.logicalKey === key) ?? null) : null);

export const userName = (payload: WorkspacePayload, id: string) => (id === "system" ? "Blink (system)" : (payload.users[id] ?? id));

export const QUOTE_ROLE_LABEL: Record<string, string> = { primary: "statement", context: "context", source_attribution: "source", correction: "correction" };

export const EVIDENCE_MARK: Record<string, { mark: string; label: string; className: string }> = {
  supported: { mark: "✓", label: "supported", className: "text-success" },
  refuted: { mark: "✗", label: "refuted", className: "text-muted-foreground" },
  unknown: { mark: "?", label: "unknown", className: "text-warning" },
  conflict: { mark: "!", label: "conflict", className: "text-destructive" },
};

export const TRI_LABEL: Record<string, { label: string; className: string }> = {
  true: { label: "true", className: "text-success" },
  false: { label: "false", className: "text-muted-foreground" },
  indeterminate: { label: "indeterminate", className: "text-warning" },
};
