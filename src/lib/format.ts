/** Display helpers shared by server and client components. No I/O. */

export const shortHash = (hash: string | null | undefined, n = 10) => (hash ? hash.slice(0, n) : "—");

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
}

export function formatMinutes(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const minutes = ms / 60000;
  return minutes < 1 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${minutes.toFixed(1)} min`;
}

export const formatUsd = (n: number) => (n < 0.01 && n > 0 ? "<$0.01" : `$${n.toFixed(2)}`);
export const formatPercent = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(digits)}%`);
export const formatCount = (n: number) => n.toLocaleString("en-US");

/** "REVIEW_REQUIRED" → "Review required". */
export function humanize(value: string): string {
  const s = value.replaceAll("_", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const OUTCOME_LABEL: Record<string, string> = {
  cleared_for_research: "Unhide: cleared for research",
  restricted_exclude: "Keep hidden",
  restricted_escalate_to_legal: "Keep hidden and send to legal",
  no_concern: "Unhide: no concern",
};

/** What a finding's hidden state means for the banker, in the words compliance reads. */
export const HIDDEN_STATUS_LABEL: Record<"until_decided" | "kept_hidden" | "shown_on_release", string> = {
  until_decided: "Hidden from the banker until you decide",
  kept_hidden: "Hidden from the banker",
  shown_on_release: "Shown to the banker on release",
};

export const ROLE_LABEL: Record<string, string> = {
  analyst: "Analyst",
  reviewer: "Compliance reviewer",
  senior_reviewer: "Senior compliance officer",
  policy_owner: "Policy owner",
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
