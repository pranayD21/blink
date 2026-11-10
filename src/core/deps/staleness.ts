/**
 * The staleness pass (§12.3), pure half.
 *
 * Every decision, attestation, and approval records the exact evidence it
 * rested on as (source, hash) edges. This function compares those edges with
 * the current hashes and reports which dependents no longer hold. It is
 * precise: a correction to a turn only the brief cites leaves the finding
 * decisions about other turns intact.
 */

export type DependentType = "decision" | "attestation" | "approval" | "finding" | "brief";
export type SourceType = "turn" | "claim" | "context_fact" | "policy_version" | "document" | "brief" | "decision";

export interface DependencyRow {
  dependentType: DependentType;
  dependentId: string;
  sourceType: SourceType;
  sourceId: string;
  sourceHash: string;
  /** Human label recorded with the edge, e.g. "T19" or "C7 · T19". */
  sourceLabel: string;
}

export interface CurrentSource {
  /** Current hash after following lineage to the newest version; null when the source no longer exists. */
  hash: string | null;
  /** Optional fresher label (a turn may have been renumbered). */
  label?: string;
}

export interface StaleReason {
  sourceType: SourceType;
  sourceId: string;
  sourceLabel: string;
  oldHash: string;
  newHash: string | null;
}

export interface StaleDependent {
  dependentType: DependentType;
  dependentId: string;
  reasons: StaleReason[];
}

export function findStale(
  dependencies: readonly DependencyRow[],
  resolve: (sourceType: SourceType, sourceId: string) => CurrentSource,
): StaleDependent[] {
  const byDependent = new Map<string, StaleDependent>();
  const cache = new Map<string, CurrentSource>();
  for (const dep of dependencies) {
    const cacheKey = `${dep.sourceType}\u0000${dep.sourceId}`;
    let current = cache.get(cacheKey);
    if (!current) {
      current = resolve(dep.sourceType, dep.sourceId);
      cache.set(cacheKey, current);
    }
    if (current.hash === dep.sourceHash) continue;
    const key = `${dep.dependentType}\u0000${dep.dependentId}`;
    let entry = byDependent.get(key);
    if (!entry) {
      entry = { dependentType: dep.dependentType, dependentId: dep.dependentId, reasons: [] };
      byDependent.set(key, entry);
    }
    entry.reasons.push({
      sourceType: dep.sourceType,
      sourceId: dep.sourceId,
      sourceLabel: current.label ?? dep.sourceLabel,
      oldHash: dep.sourceHash,
      newHash: current.hash,
    });
  }
  return [...byDependent.values()];
}

const SOURCE_NOUN: Record<SourceType, string> = {
  turn: "transcript turn",
  claim: "claim",
  context_fact: "context fact",
  policy_version: "policy version",
  document: "public document",
  brief: "brief",
  decision: "decision",
};

/** "claim changed (C7 · T19)", "transcript turn removed (T4)". */
export function describeStaleReason(reason: StaleReason): string {
  const verb = reason.newHash === null ? "removed" : "changed";
  return `${SOURCE_NOUN[reason.sourceType]} ${verb}${reason.sourceLabel ? ` (${reason.sourceLabel})` : ""}`;
}

export function describeStaleReasons(reasons: readonly StaleReason[], max = 3): string {
  const parts = reasons.slice(0, max).map(describeStaleReason);
  if (reasons.length > max) parts.push(`and ${reasons.length - max} more`);
  return parts.join("; ");
}
