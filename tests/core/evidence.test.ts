import { describe, expect, it } from "vitest";
import { turnHash } from "@/core/deps/hash";
import { describeStaleReasons, findStale } from "@/core/deps/staleness";
import { type ComparableDocument, compareClaim, describeMismatches, isComparable, metricFamily } from "@/core/evidence/compare";
import { diffTurns, planClaimMatch, textSimilarity } from "@/core/evidence/lineage";
import { locateQuote, normalizeWithMap, validateQuote } from "@/core/evidence/quote";
import { parseTranscript } from "@/core/transcript/parse";
import type { ClaimFields } from "@/core/types";
import { loadGoldDocuments, loadHalvorsenContext, readFixture } from "../helpers/fixtures";

describe("quote location (§10.3)", () => {
  const turns = [
    { label: "T1", idx: 1, speaker: "analyst", text: "Where does that number come from?" },
    { label: "T2", idx: 2, speaker: "expert", text: "That’s Halvorsen’s West region — this   quarter. I still have a login." },
    { label: "T3", idx: 3, speaker: "expert", text: "Pricing is holding though." },
    { label: "T4", idx: 4, speaker: "expert", text: "Pricing is holding though, and lead times have come in." },
  ];

  it("exact match returns offsets into the turn", () => {
    expect(locateQuote("Orders fell off a cliff.", "fell off")).toEqual({ start: 7, end: 15, normalized: false });
    expect(validateQuote("T1", "that number", turns)).toMatchObject({ status: "ok", turnLabel: "T1", match: { start: 11, end: 22, normalized: false } });
  });

  it("normalized match handles curly quotes, dashes, and whitespace, mapping offsets back", () => {
    const text = turns[1].text;
    const match = locateQuote(text, "That's Halvorsen's West region - this quarter.")!;
    expect(match.normalized).toBe(true);
    expect(text.slice(match.start, match.end)).toBe("That’s Halvorsen’s West region — this   quarter.");
  });

  it("stays case-sensitive", () => {
    expect(locateQuote("Orders fell.", "orders fell")).toBeNull();
  });

  it("reassigns a quote that appears in exactly one other expert turn", () => {
    expect(validateQuote("T1", "I still have a login.", turns)).toMatchObject({ status: "reassigned", turnLabel: "T2", reassignedFrom: "T1" });
  });

  it("drops a quote that is ambiguous or not there", () => {
    expect(validateQuote("T1", "Pricing is holding though", turns)).toMatchObject({ status: "not_found" });
    expect(validateQuote("T2", "orders fell forty percent", turns)).toMatchObject({ status: "not_found" });
    expect(validateQuote("T9", "nothing here at all", turns)).toMatchObject({ status: "not_found" });
    // A quote from the analyst's turn is never reattached to the expert.
    expect(validateQuote("T3", "Where does that number come from?", turns)).toMatchObject({ status: "not_found" });
  });

  it("normalization keeps a character-to-source map", () => {
    const { text, map } = normalizeWithMap("a “b”\n\n c");
    expect(text).toBe('a "b" c');
    expect(map).toEqual([0, 1, 2, 3, 4, 5, 8]);
  });
});

describe("public-evidence comparator (§11.2)", () => {
  const { ctx } = loadHalvorsenContext();
  const docs = loadGoldDocuments();
  const fields = (over: Partial<ClaimFields>): ClaimFields => ({
    summary: "s",
    speaker: "expert",
    subject_entity: { name: "Halvorsen", kind: "issuer" },
    metric: { category: "bookings", label: "bookings" },
    event_kind: "none",
    period: { label: null, fiscal_year: 2027, fiscal_quarter: 3, calendar_year: null, calendar_quarter: null, relative: "current" },
    value: { number: 20, unit: "percent", direction: "down", baseline: null },
    scope: "segment_or_region",
    scope_detail: "West region",
    knowledge_basis: "internal_system",
    access_timing: "after_employment",
    confidentiality_signals: [],
    qualifications: [],
    is_correction_of: null,
    ...over,
  });

  it("orders and bookings are one metric family", () => {
    expect(metricFamily("orders")).toBe(metricFamily("bookings"));
    expect(metricFamily("revenue")).not.toBe(metricFamily("orders"));
  });

  it("wrong period and wrong scope: Q3 West region bookings vs the Q2 company-wide 10-Q figure", () => {
    const r = compareClaim(fields({}), docs, ctx);
    expect(r.outcome).toBe("mismatch_only");
    expect(r.state).toBe("refuted");
    expect(r.best?.documentId).toBe("hlvp-10q-q2fy27");
    expect(r.reasons).toEqual(["period", "scope"]);
    expect(describeMismatches(r.best!)).toBe("Period: claim Q3 FY2027 vs document Q2 FY2027; Scope: claim segment or region (West region) vs document company-wide");
    expect(r.summary).toContain("not proof of nonpublic status");
    // The value is not compared across a different period or scope.
    expect(r.best!.dimensions.find((d) => d.dimension === "value")).toMatchObject({ verdict: "unknown" });
  });

  it("exact match: 'down high single digits' at Q2 vs the 10-Q's 8% decrease", () => {
    const r = compareClaim(
      fields({ metric: { category: "orders", label: "orders" }, period: { label: "Q2 report", fiscal_year: 2027, fiscal_quarter: 2, calendar_year: null, calendar_quarter: null, relative: "prior" }, value: { number: null, unit: "percent", direction: "down", baseline: null }, scope: "company_wide", scope_detail: null }),
      docs,
      ctx,
    );
    expect(r.outcome).toBe("exact_match");
    expect(r.state).toBe("supported");
    expect(r.best).toMatchObject({ documentId: "hlvp-10q-q2fy27", factId: "F1", classification: "exact" });
    expect(r.best!.dimensions.find((d) => d.dimension === "value")).toMatchObject({ verdict: "match" });
  });

  it("numeric tolerance: ±2 percentage points; a different direction is a mismatch", () => {
    const q2 = (number: number, direction: "up" | "down") =>
      compareClaim(fields({ metric: { category: "orders", label: "o" }, period: { label: null, fiscal_year: 2027, fiscal_quarter: 2, calendar_year: null, calendar_quarter: null, relative: "prior" }, value: { number, unit: "percent", direction, baseline: null }, scope: "company_wide" }), docs, ctx);
    expect(q2(9.5, "down").outcome).toBe("exact_match");
    expect(q2(11, "down")).toMatchObject({ outcome: "mismatch_only", reasons: ["value"] });
    expect(q2(8, "up")).toMatchObject({ outcome: "mismatch_only", reasons: ["value"] });
  });

  it("published after the call: the Brightwater 8-K is a candidate and is rejected", () => {
    const r = compareClaim(
      fields({ metric: null, event_kind: "contract_change", period: { label: "being re-bid", fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "current" }, value: null, scope: "single_customer", scope_detail: "Cardinal Utilities" }),
      docs,
      ctx,
    );
    expect(r.outcome).toBe("mismatch_only");
    expect(r.best).toMatchObject({ documentId: "brightwater-8k-2026-11-10", factId: "F1" });
    expect(r.reasons).toEqual(["PUBLISHED_AFTER_CALL"]);
    // The Brightwater-side fact is also a candidate, and is further away.
    expect(r.candidates.find((c) => c.factId === "F2")!.mismatchReasons).toEqual(["entity", "PUBLISHED_AFTER_CALL"]);
  });

  it("no candidates: says so without claiming non-public status", () => {
    const r = compareClaim(fields({ metric: { category: "margin", label: "margins" } }), docs, ctx);
    expect(r).toMatchObject({ outcome: "no_candidates", state: "refuted", searchedDocuments: 6 });
    expect(r.summary).toBe("No match in the 6 searched documents (not proof of nonpublic status)");
  });

  it("partial match: entity and metric match but the period is unknown", () => {
    const r = compareClaim(fields({ metric: { category: "pricing", label: "pricing" }, period: { label: null, fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: "unspecified" }, value: null, scope: "company_wide" }), docs, ctx);
    expect(r).toMatchObject({ outcome: "partial_match", state: "unknown" });
    expect(r.summary).toContain("Proposed match — verify");
  });

  it("is only run for claims that are, or may be, about the covered issuer", () => {
    expect(isComparable(fields({}), ctx)).toBe(true);
    expect(isComparable(fields({ subject_entity: { name: null, kind: "unknown" } }), ctx)).toBe(true);
    expect(isComparable(fields({ subject_entity: { name: null, kind: "industry" } }), ctx)).toBe(false);
    expect(isComparable(fields({ subject_entity: { name: "Brightwater", kind: "competitor" } }), ctx)).toBe(false);
    expect(isComparable(fields({ metric: null }), ctx)).toBe(false);
  });

  it("ignores documents that do not concern the issuer", () => {
    const unrelated: ComparableDocument = { id: "x", title: "Other", issuer: "Acme Valves", relatedIssuers: [], publishedAt: "2026-01-01", sourceType: "filing", facts: docs[1].facts };
    expect(compareClaim(fields({}), [unrelated], ctx).outcome).toBe("no_candidates");
  });
});

describe("turn lineage and claim matching (§10.4)", () => {
  const turn = (label: string, text: string, speaker = "expert") => ({ label, speaker, text, textHash: turnHash(text) });

  it("transcript v2 differs from v1 only in T19", () => {
    const v1 = parseTranscript(readFixture("cases", "halvorsen", "transcript-v1.txt"));
    const v2 = parseTranscript(readFixture("cases", "halvorsen", "transcript-v2.txt"));
    const rows = diffTurns(v1.turns.map((t) => turn(t.label, t.text, t.speaker)), v2.turns.map((t) => turn(t.label, t.text, t.speaker)));
    expect(rows).toHaveLength(22);
    expect(rows.filter((r) => r.change !== "same")).toEqual([{ oldLabel: "T19", newLabel: "T19", change: "edited" }]);
  });

  it("detects added, removed, and edited turns, renumbering the rest", () => {
    const oldTurns = [turn("T1", "alpha beta gamma"), turn("T2", "delta epsilon zeta eta"), turn("T3", "to be removed entirely"), turn("T4", "omega")];
    const newTurns = [turn("T1", "a brand new opening remark"), turn("T2", "alpha beta gamma"), turn("T3", "delta epsilon zeta theta"), turn("T4", "omega")];
    expect(diffTurns(oldTurns, newTurns)).toEqual([
      { oldLabel: null, newLabel: "T1", change: "added" },
      { oldLabel: "T1", newLabel: "T2", change: "same" },
      { oldLabel: "T2", newLabel: "T3", change: "edited" },
      { oldLabel: "T3", newLabel: null, change: "removed" },
      { oldLabel: "T4", newLabel: "T4", change: "same" },
    ]);
    expect(textSimilarity("delta epsilon zeta eta", "delta epsilon zeta theta")).toBe(0.75);
  });

  it("carries untouched claims, revises the one whose turn was edited, and keeps logical keys", () => {
    const lineage = [
      { oldLabel: "T5", newLabel: "T5", change: "same" as const },
      { oldLabel: "T11", newLabel: "T11", change: "same" as const },
      { oldLabel: "T19", newLabel: "T19", change: "edited" as const },
      { oldLabel: "T21", newLabel: "T21", change: "same" as const },
    ];
    const oldClaims = [
      { logicalKey: "C1", quotes: [{ turnLabel: "T5", start: 10, end: 60 }, { turnLabel: "T11", start: 0, end: 40 }] },
      { logicalKey: "C9", quotes: [{ turnLabel: "T19", start: 20, end: 110 }] },
      { logicalKey: "C10", quotes: [{ turnLabel: "T21", start: 11, end: 120 }] },
    ];
    // The new run numbers its claims differently and words C1's quote slightly differently.
    const newClaims = [
      { logicalKey: "C1", quotes: [{ turnLabel: "T19", start: 20, end: 113 }] },
      { logicalKey: "C2", quotes: [{ turnLabel: "T5", start: 0, end: 60 }, { turnLabel: "T11", start: 0, end: 40 }] },
      { logicalKey: "C3", quotes: [{ turnLabel: "T21", start: 11, end: 120 }] },
      { logicalKey: "C4", quotes: [{ turnLabel: "T7", start: 0, end: 30 }] },
    ];
    const { plans, keyMap } = planClaimMatch(oldClaims, newClaims, lineage);
    expect(plans).toEqual([
      { action: "carry", logicalKey: "C1", oldKey: "C1", newKey: "C2" },
      { action: "revise", logicalKey: "C9", oldKey: "C9", newKey: "C1" },
      { action: "carry", logicalKey: "C10", oldKey: "C10", newKey: "C3" },
      { action: "create", logicalKey: "C4", newKey: "C4" },
    ]);
    expect(keyMap).toEqual({ C2: "C1", C1: "C9", C3: "C10", C4: "C4" });
  });

  it("retires a claim whose evidence was removed, and carries one the new run simply missed", () => {
    const lineage = [
      { oldLabel: "T1", newLabel: "T1", change: "same" as const },
      { oldLabel: "T2", newLabel: null, change: "removed" as const },
    ];
    const { plans } = planClaimMatch([{ logicalKey: "C1", quotes: [{ turnLabel: "T1", start: 0, end: 9 }] }, { logicalKey: "C2", quotes: [{ turnLabel: "T2", start: 0, end: 9 }] }], [], lineage);
    expect(plans).toEqual([
      { action: "carry", logicalKey: "C1", oldKey: "C1", newKey: null },
      { action: "retire", logicalKey: "C2", oldKey: "C2" },
    ]);
  });

  it("gives a brand-new claim a key that does not collide", () => {
    const lineage = [{ oldLabel: "T1", newLabel: "T1", change: "same" as const }, { oldLabel: null, newLabel: "T2", change: "added" as const }];
    const { plans } = planClaimMatch([{ logicalKey: "C1", quotes: [{ turnLabel: "T1", start: 0, end: 9 }] }, { logicalKey: "C3", quotes: [{ turnLabel: "T1", start: 20, end: 30 }] }], [{ logicalKey: "C1", quotes: [{ turnLabel: "T2", start: 0, end: 5 }] }], lineage);
    expect(plans.find((p) => p.action === "create")).toEqual({ action: "create", logicalKey: "C4", newKey: "C1" });
  });
});

describe("staleness (§12.3)", () => {
  const dep = (dependentType: "decision" | "attestation" | "approval", dependentId: string, sourceType: "turn" | "claim" | "policy_version", sourceId: string, sourceHash: string, sourceLabel: string) => ({ dependentType, dependentId, sourceType, sourceId, sourceHash, sourceLabel });
  const deps = [
    dep("decision", "d1", "claim", "C1", "c1-hash", "C1 · T5, T11"),
    dep("decision", "d1", "turn", "T5", "t5-hash", "T5"),
    dep("decision", "d1", "policy_version", "pv1", "bundle", "policy v1"),
    dep("approval", "a1", "claim", "C9", "c9-hash", "C9 · T19"),
    dep("attestation", "att1", "turn", "T5", "t5-hash", "T5"),
    dep("attestation", "att1", "turn", "T19", "t19-hash", "T19"),
  ];
  const current: Record<string, string | null> = { "claim:C1": "c1-hash", "turn:T5": "t5-hash", "policy_version:pv1": "bundle", "claim:C9": "c9-hash", "turn:T19": "t19-hash" };
  const resolver = (over: Record<string, string | null>) => (type: string, id: string) => ({ hash: { ...current, ...over }[`${type}:${id}`] ?? null });

  it("nothing is stale while hashes match", () => {
    expect(findStale(deps, resolver({}))).toEqual([]);
  });

  it("is precise: a change to T19 touches only what depends on T19", () => {
    const stale = findStale(deps, resolver({ "turn:T19": "t19-new", "claim:C9": "c9-new" }));
    expect(stale.map((s) => [s.dependentType, s.dependentId]).sort()).toEqual([["approval", "a1"], ["attestation", "att1"]]);
    expect(describeStaleReasons(stale.find((s) => s.dependentId === "a1")!.reasons)).toBe("claim changed (C9 · T19)");
    expect(describeStaleReasons(stale.find((s) => s.dependentId === "att1")!.reasons)).toBe("transcript turn changed (T19)");
  });

  it("a removed source makes its dependents stale", () => {
    const stale = findStale(deps, resolver({ "claim:C1": null }));
    expect(stale).toHaveLength(1);
    expect(stale[0]).toMatchObject({ dependentType: "decision", dependentId: "d1" });
    expect(describeStaleReasons(stale[0].reasons)).toBe("claim removed (C1 · T5, T11)");
  });

  it("a new policy version makes decisions made under the old one stale", () => {
    expect(findStale(deps, resolver({ "policy_version:pv1": "bundle-2" })).map((s) => s.dependentId)).toEqual(["d1"]);
  });
});
