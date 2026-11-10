/**
 * The committed recordings and the current prompts belong together (§13.3).
 *
 * A request is keyed by a hash of its prompt, so editing a prompt without
 * re-recording turns the offline demo into a replay miss. These tests replay
 * every recorded stage through the production code paths and check the
 * outcomes the demo depends on. They read files only; no network.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, resetDbForTests, transact } from "@/server/db/client";
import { jobs, llmCalls } from "@/server/db/schema";
import { runEval } from "@/server/eval/run";
import { drainJobs } from "@/server/jobs/runner";
import { listDocuments } from "@/server/services/documents";
import { endCall, ingestTurn, startCall, turnsSettled } from "@/server/services/live";
import { approvePolicy, createPolicy, policyDetail, requestCompile } from "@/server/services/policies";
import { fixturePolicyInput, halvorsenLiveTurns, readFixtureText, seedDatabase } from "@/server/services/seed";
import { uploadTranscript } from "@/server/services/transcripts";
import { loadWorkspace } from "@/server/services/workspace";
import { CASE, seedEmpty, user } from "../helpers/db";

const failedJobs = () => getDb().select().from(jobs).where(eq(jobs.status, "failed")).all().map((j) => `${j.type}: ${j.error}`);

describe("recorded model responses replay through the real pipeline", () => {
  beforeAll(async () => {
    resetDbForTests();
    // The default seed queues document-fact extraction, exactly as `pnpm db:reset` does.
    await seedDatabase();
    await drainJobs();
  });

  it("document facts: all six curated documents", () => {
    expect(failedJobs()).toEqual([]);
    const docs = listDocuments(getDb());
    expect(docs).toHaveLength(6);
    expect(docs.every((d) => d.factsStatus === "extracted" && d.facts.length > 0)).toBe(true);
  });

  it("the broken policy ends COMPILE_FAILED on a dropped required clause", async () => {
    const dana = user("dana");
    const { policyVersionId } = transact((tx) => createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1-broken.md"), dana));
    transact((tx) => requestCompile(tx, policyVersionId, dana));
    await drainJobs();
    const detail = policyDetail(getDb(), policyVersionId);
    expect(detail.validation?.compileError ?? null).toBeNull();
    expect(detail.status).toBe("COMPILE_FAILED");
    expect(detail.validation!.issues.filter((i) => i.severity === "blocking").map((i) => i.code)).toContain("CLAUSE_DROPPED");
  });

  it("policy v1 compiles to VALIDATED on the first attempt and passes all eight reviewer scenarios", async () => {
    const dana = user("dana");
    const { policyVersionId } = transact((tx) => createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1.md"), dana));
    transact((tx) => requestCompile(tx, policyVersionId, dana));
    await drainJobs();
    const detail = policyDetail(getDb(), policyVersionId);
    expect(detail.validation?.compileError ?? null).toBeNull();
    expect(detail.status).toBe("VALIDATED");
    expect(detail.attempts.map((a) => a.stage)).toEqual(["pass_a", "pass_b", "assembly", "scenarios"]);
    expect(detail.scenarios!.reviewer).toMatchObject({ passed: 8, total: 8 });
    expect(detail.validation!.totals).toMatchObject({ monitors: 4, deterministic: true, indeterminate_handled: true });
    expect(detail.llm).toMatchObject({ calls: 4, replayed: 4 });
    // The compiled rules have the shape the spec's expected-outcome table describes (§17.2).
    const byParagraph = (p: string) => detail.rulesDoc!.rules.find((r) => r.source_clause_ids.some((id) => detail.inventory!.clauses.find((c) => c.clause_id === id)?.paragraph === p))!;
    expect(byParagraph("P2")).toMatchObject({ on_true: "open_review", on_indeterminate: "open_context_task" });
    expect(byParagraph("P3")).toMatchObject({ on_true: "open_review_and_escalate", on_indeterminate: "open_context_task" });
    expect(byParagraph("P4")).toMatchObject({ on_true: "open_review", on_indeterminate: "open_review" });
    expect(byParagraph("P5")).toMatchObject({ on_true: "open_review", on_indeterminate: "open_context_task" });
    transact((tx) => approvePolicy(tx, policyVersionId, detail.bundleHash!, dana));
  });

  it("transcript v1 under the AI-compiled policy yields the gold findings", async () => {
    transact((tx) => uploadTranscript(tx, CASE, { text: readFixtureText("cases", "halvorsen", "transcript-v1.txt"), filename: "transcript-v1.txt", source: "ai" }, user("priya")));
    await drainJobs();
    expect(failedJobs()).toEqual([]);
    const ws = loadWorkspace(getDb(), CASE, user("marcus"));
    expect(ws.run).toMatchObject({ status: "succeeded", source: "ai", replayed: true });
    const policy = ws.findings.filter((f) => f.origin === "policy");
    expect(policy.map((f) => [f.label, f.turnLabels.join("+"), f.state])).toEqual([
      ["F1", "T5+T11", "REVIEW_REQUIRED"],
      ["F2", "T15", "REVIEW_REQUIRED"],
      ["F3", "T17", "NEEDS_CONTEXT"],
    ]);
    expect(policy[0].path.map((p) => `${p.state}${p.turnLabel ? `@${p.turnLabel}` : ""}`)).toEqual(["UNASSESSED", "NEEDS_CONTEXT@T5", "REVIEW_REQUIRED@T11"]);
    expect(policy[0].escalationRequired).toBe(true);
    const comparisonAt = (turn: string) => ws.claims.find((c) => c.turnLabels.includes(turn) && c.comparison)?.comparison;
    expect(comparisonAt("T11")).toMatchObject({ outcome: "mismatch_only", reasons: ["period", "scope"] });
    expect(comparisonAt("T13")).toMatchObject({ outcome: "exact_match" });
    expect(comparisonAt("T15")).toMatchObject({ outcome: "mismatch_only", reasons: ["PUBLISHED_AFTER_CALL"] });
    const stats = (ws.run!.report as { stats: { proposedQuotes: number; validQuotes: number } }).stats;
    expect(stats.validQuotes).toBe(stats.proposedQuotes);
  });

  it("no replayed call reached the network", () => {
    const calls = getDb().select().from(llmCalls).all();
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.every((c) => c.replayed)).toBe(true);
  });
});

describe("pnpm eval in replay mode", () => {
  beforeAll(seedEmpty);

  it("scores all nine fixtures from recordings: every expected finding found, none extra", async () => {
    const result = await runEval();
    expect(result.mode).toBe("replay");
    expect(result.fixtures.map((f) => f.id)).toEqual(["Halvorsen", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"]);
    for (const f of result.fixtures) {
      expect(f.error, f.id).toBeUndefined();
      expect(f, f.id).toMatchObject({ status: "scored", replayed: true, extraFindings: 0, missed: [], stateMismatches: [], assertionFailures: [] });
      expect(f.matchedFindings, f.id).toBe(f.expectedFindings);
      expect(f.quotes.valid, f.id).toBe(f.quotes.proposed);
      for (const c of f.comparisons ?? []) expect(c.ok, `${f.id} comparison at ${c.turn}`).toBe(true);
    }
  });
});

describe("the scripted live call replays (pnpm live:check)", () => {
  beforeAll(async () => {
    resetDbForTests();
    // The live e2e server's starting point: the manual policy, document facts extracted, Halvorsen at intake.
    await seedDatabase({ manualPolicy: true });
    await drainJobs();
  });

  it("the real live reader turns the pill red at T11, reads every turn, and the after-call read runs", async () => {
    const priya = user("priya");
    const call = transact((tx) => startCall(tx, { caseId: CASE }, priya));
    const at = (ms: number) => new Date(Date.parse("2026-11-10T15:00:00.000Z") + ms).toISOString();
    const decisions = [];
    for (const t of halvorsenLiveTurns()) decisions.push(await ingestTurn(call.id, { ...t, speechEndedAt: at(t.speechEndMs), transcribedAt: at(t.speechEndMs + 200) }, priya));
    await turnsSettled(call.id);

    expect(decisions.map((d) => d.readStatus).filter((s) => s !== "read")).toEqual([]);
    expect(decisions[10]).toMatchObject({ seq: 11, pill: { level: "red" } });
    expect(decisions.slice(0, 10).map((d) => d.pill.level)).not.toContain("red");

    const ended = transact((tx) => endCall(tx, call.id, priya));
    expect(ended.hiddenCount).toBeGreaterThan(0);
    await drainJobs();
    expect(failedJobs()).toEqual([]);
    const live = getDb().select().from(llmCalls).where(eq(llmCalls.stage, "live_read")).all();
    expect(live).toHaveLength(22);
    expect(getDb().select().from(llmCalls).all().every((c) => c.replayed)).toBe(true);
  });
});
