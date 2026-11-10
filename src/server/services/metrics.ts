/**
 * The metrics page (§18.3). Every number here is measured from what the app
 * recorded. On synthetic fixtures these show that the measurement works; they
 * are not production accuracy and the page says so.
 */
import { desc, eq } from "drizzle-orm";
import { type DbOrTx, fromJson } from "../db/client";
import { analysisRuns, auditEvents, cases, decisions, evalRuns, findings, llmCalls, reviewSessions } from "../db/schema";
import { costUsd } from "../llm/client";

/** Pilot target from §1.5: 30% less review time per call. A target, never a result. */
export const PILOT_TARGET_SAVED = 0.3;

/** With fixed review hours, saving a fraction s of time per call allows 1/(1−s) − 1 more calls. */
export const moreCalls = (saved: number) => (saved >= 1 ? Number.POSITIVE_INFINITY : 1 / (1 - saved) - 1);

export interface EvalResult {
  mode: string;
  model: string;
  generatedAt: string;
  fixtures: {
    id: string;
    title: string;
    status: "scored" | "error";
    error?: string;
    replayed?: boolean;
    expectedFindings: number;
    matchedFindings: number;
    extraFindings: number;
    recall: number | null;
    precision: number | null;
    missed: string[];
    extra: string[];
    stateMismatches: string[];
    assertionsPassed: number;
    assertionsTotal: number;
    assertionFailures: string[];
    comparisons?: { turn: string; expected: string; actual: string | null; ok: boolean }[];
    quotes: { proposed: number; valid: number };
    claims: number;
  }[];
}

export function saveEvalRun(tx: DbOrTx, id: string, createdAt: string, result: EvalResult): void {
  tx.insert(evalRuns).values({ id, createdAt, mode: result.mode, resultJson: JSON.stringify(result) }).run();
}

export function loadMetrics(db: DbOrTx) {
  const caseRows = db.select().from(cases).all();
  const titleOf = new Map(caseRows.map((c) => [c.id, c.title]));

  // ── Review time, Blink vs. baseline mode ──────────────────────────────────
  const sessions = db.select().from(reviewSessions).all();
  const byMode = (mode: "blink" | "baseline") => {
    const rows = sessions.filter((s) => s.mode === mode && s.activeMs > 0);
    // One figure per case: a case reviewed in several sittings is one review.
    const perCase = new Map<string, number>();
    for (const s of rows) perCase.set(s.caseId, (perCase.get(s.caseId) ?? 0) + s.activeMs);
    const values = [...perCase.values()];
    return {
      sessions: rows.length,
      cases: values.length,
      avgMs: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
      perCase: [...perCase.entries()].map(([caseId, activeMs]) => ({ caseId, title: titleOf.get(caseId) ?? caseId, activeMs })),
    };
  };
  const blink = byMode("blink");
  const baseline = byMode("baseline");
  const saved = blink.avgMs !== null && baseline.avgMs !== null && baseline.avgMs > 0 ? 1 - blink.avgMs / baseline.avgMs : null;

  // ── Reviewer corrections per case (a quality proxy) ───────────────────────
  const corrections = db.select().from(auditEvents).where(eq(auditEvents.type, "CLAIM_CORRECTED")).all();
  const findingRows = db.select().from(findings).all();
  const decisionRows = db.select().from(decisions).all();
  const perCase = caseRows.map((c) => {
    const caseFindings = findingRows.filter((f) => f.caseId === c.id);
    const aiSuggested = caseFindings.filter((f) => f.origin === "ai_suggested");
    const dismissed = aiSuggested.filter((f) => f.state === "DISPOSITIONED" && decisionRows.some((d) => d.findingId === f.id && !d.stale && d.outcome === "no_concern")).length;
    return {
      caseId: c.id,
      title: c.title,
      claimCorrections: corrections.filter((e) => e.caseId === c.id).length,
      reviewerFindings: caseFindings.filter((f) => f.origin === "reviewer").length,
      aiSuggestions: aiSuggested.length,
      aiSuggestionsDismissed: dismissed,
      policyFindings: caseFindings.filter((f) => f.origin === "policy").length,
    };
  });

  // ── Quote validity ────────────────────────────────────────────────────────
  const runs = db.select().from(analysisRuns).where(eq(analysisRuns.status, "succeeded")).all();
  let proposed = 0;
  let valid = 0;
  for (const run of runs.filter((r) => r.source === "ai")) {
    const stats = fromJson<{ stats?: { proposedQuotes: number; validQuotes: number } } | null>(run.reportJson, null)?.stats;
    if (stats) {
      proposed += stats.proposedQuotes;
      valid += stats.validQuotes;
    }
  }

  // ── Cost and latency per stage: real tokens × list price ──────────────────
  // Calls made by `pnpm eval` are measurement, not review work, so they are left out of the cost table.
  const calls = db.select().from(llmCalls).all().filter((c) => !fromJson<{ eval?: string }>(c.refJson, {}).eval);
  const stages = new Map<string, { stage: string; calls: number; replayed: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number; unpricedCalls: number; latencyMs: number }>();
  // Cost is summed over the calls whose model has a price; a call with no price is counted, never added as zero.
  const costByCase = new Map<string, { costUsd: number; unpricedCalls: number }>();
  for (const call of calls) {
    const cost = costUsd({ input_tokens: call.inputTokens, output_tokens: call.outputTokens, cache_read_input_tokens: call.cacheReadTokens, cache_creation_input_tokens: call.cacheCreationTokens }, call.model);
    const s = stages.get(call.stage) ?? { stage: call.stage, calls: 0, replayed: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, unpricedCalls: 0, latencyMs: 0 };
    s.calls++;
    if (call.replayed) s.replayed++;
    s.inputTokens += call.inputTokens;
    s.outputTokens += call.outputTokens;
    s.cacheReadTokens += call.cacheReadTokens;
    if (cost === null) s.unpricedCalls++;
    else s.costUsd += cost;
    s.latencyMs += call.latencyMs;
    stages.set(call.stage, s);
    const caseId = fromJson<{ caseId?: string }>(call.refJson, {}).caseId;
    if (caseId) {
      const c = costByCase.get(caseId) ?? { costUsd: 0, unpricedCalls: 0 };
      if (cost === null) c.unpricedCalls++;
      else c.costUsd += cost;
      costByCase.set(caseId, c);
    }
  }

  const evalRow = db.select().from(evalRuns).orderBy(desc(evalRuns.createdAt)).limit(1).get();
  const evalResult = evalRow ? fromJson<EvalResult | null>(evalRow.resultJson, null) : null;

  return {
    reviewTime: {
      blink,
      baseline,
      savedFraction: saved,
      moreCallsFraction: saved !== null && saved > 0 ? moreCalls(saved) : null,
      target: { savedFraction: PILOT_TARGET_SAVED, moreCallsFraction: moreCalls(PILOT_TARGET_SAVED) },
    },
    corrections: perCase,
    quotes: { proposed, valid, rate: proposed > 0 ? valid / proposed : null },
    llm: {
      stages: [...stages.values()].map((s) => ({ ...s, avgLatencyMs: s.calls > 0 ? s.latencyMs / s.calls : 0, avgCostUsd: s.calls > s.unpricedCalls ? s.costUsd / (s.calls - s.unpricedCalls) : null })).sort((a, b) => (a.stage < b.stage ? -1 : 1)),
      totalCostUsd: [...stages.values()].reduce((n, s) => n + s.costUsd, 0),
      /** Calls whose model has no listed price: left out of every cost figure, and said so. */
      unpricedCalls: [...stages.values()].reduce((n, s) => n + s.unpricedCalls, 0),
      anyReplayed: calls.some((c) => c.replayed),
      perCase: [...costByCase.entries()].map(([caseId, c]) => ({ caseId, title: titleOf.get(caseId) ?? caseId, costUsd: c.costUsd, unpricedCalls: c.unpricedCalls })),
    },
    eval: evalResult ? { ...evalResult, storedAt: evalRow!.createdAt } : null,
    missedConcerns: evalResult ? evalResult.fixtures.flatMap((f) => f.missed.map((m) => `${f.id}: ${m}`)) : [],
  };
}
