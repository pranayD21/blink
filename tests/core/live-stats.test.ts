import { describe, expect, it } from "vitest";
import { percentile, summarizeLatency } from "@/core/live/stats";

describe("percentile", () => {
  it("uses the nearest rank", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });
  it("is null when there is nothing to rank", () => expect(percentile([], 50)).toBeNull());
  it("does not reorder its input", () => {
    const v = [3, 1, 2];
    percentile(v, 50);
    expect(v).toEqual([3, 1, 2]);
  });
});

describe("summarizeLatency", () => {
  it("reports typical, 19-in-20 and worst, never an average", () => {
    const v = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    expect(summarizeLatency(v)).toEqual({ n: 20, p50: 1000, p95: 1900, max: 2000 });
  });
  it("is all null for no turns", () => expect(summarizeLatency([])).toEqual({ n: 0, p50: null, p95: null, max: null }));
});
