/** Latency summaries: typical (median), 19-in-20 (95th percentile) and worst, never an average. Pure. */

/** Nearest-rank percentile: rank = ceil(p/100 * n), value = sorted[rank - 1]. Null when there is nothing to rank. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1];
}

export interface LatencySummary {
  n: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function summarizeLatency(values: readonly number[]): LatencySummary {
  return {
    n: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    max: values.length === 0 ? null : Math.max(...values),
  };
}
