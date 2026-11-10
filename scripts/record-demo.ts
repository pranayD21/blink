/**
 * Runs the whole demo script (§19) through the services, in a scratch
 * database, and checks each step against the gold labels.
 *
 *   BLINK_LLM_MODE=record tsx scripts/record-demo.ts    record what is missing (calls the API)
 *   BLINK_LLM_MODE=replay tsx scripts/record-demo.ts    prove the recordings replay offline
 *
 * The same requests are made by the app when a person clicks through the
 * demo, so recordings made here are the ones `pnpm demo` replays.
 *
 *   --until <step>   stop after: docfacts | broken | policy | extract | review | brief | v2 | done
 */
import { existsSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { Actor } from "../src/server/auth/actor";
import { loadActor } from "../src/server/auth/actor";
import { verifyAuditChain } from "../src/server/audit/log";
import { closeDb, getDb, migrateDb, transact } from "../src/server/db/client";
import { jobs, llmCalls } from "../src/server/db/schema";
import { loadEnv } from "../src/server/env";
import { drainJobs } from "../src/server/jobs/runner";
import { costUsd, llmMode, llmModel } from "../src/server/llm/client";
import { attestCase } from "../src/server/services/attestations";
import { approveBrief, briefWorkspace, getBrief, latestBrief, releasedBriefs, requestBriefDraft } from "../src/server/services/briefs";
import { listDocuments } from "../src/server/services/documents";
import { answerTask, applyFindingAction, getFinding } from "../src/server/services/findings";
import { currentTranscript, getCase } from "../src/server/services/loaders";
import { approvePolicy, createPolicy, policyDetail, requestCompile } from "../src/server/services/policies";
import { releaseBrief } from "../src/server/services/release";
import { HALVORSEN_CASE_ID, fixturePolicyInput, readFixtureJson, readFixtureText, seedDatabase } from "../src/server/services/seed";
import { uploadTranscript } from "../src/server/services/transcripts";
import { type FindingView, loadWorkspace } from "../src/server/services/workspace";

const STEPS = ["docfacts", "broken", "policy", "extract", "review", "brief", "v2", "done"] as const;
type Step = (typeof STEPS)[number];

const RATIONALE = "Reviewed the linked passages against the policy and the public record.";
/** Gold rule ids refer to the policy paragraph each rule implements; an AI compile may number rules differently. */
const GOLD_RULE_PARAGRAPH: Record<string, string> = { R1: "P2", R2: "P3", R3: "P4", R4: "P5" };

interface Gold {
  findings: { id: string; rules: string[]; turns: string[]; expect_state: string; escalation?: boolean; expect_history?: string[] }[];
  non_findings: { turns: string[]; why: string }[];
  comparisons: { turn: string; expect: string; reasons?: string[] }[];
}

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  console.log(`   ${ok ? "✓" : "✗"} ${message}`);
  if (!ok) problems.push(message);
};
const heading = (text: string) => console.log(`\n── ${text} ${"─".repeat(Math.max(0, 70 - text.length))}`);

async function runJobs(label: string): Promise<void> {
  const n = await drainJobs();
  const failed = getDb().select().from(jobs).where(eq(jobs.status, "failed")).all();
  if (failed.length > 0) for (const job of failed) console.log(`   ! job ${job.type} failed: ${job.error}`);
  console.log(`   ${n} job(s) ran for ${label}`);
}

async function main() {
  loadEnv();
  const untilArg = process.argv.indexOf("--until");
  const until: Step = untilArg > -1 ? (process.argv[untilArg + 1] as Step) : "done";
  if (!STEPS.includes(until)) throw new Error(`--until must be one of ${STEPS.join(", ")}`);
  /** True when the run should stop after `step`. */
  const reached = (step: Step) => STEPS.indexOf(step) >= STEPS.indexOf(until);

  process.env.BLINK_DB_PATH = "./data/record.db";
  for (const suffix of ["", "-wal", "-shm"]) if (existsSync(`./data/record.db${suffix}`)) rmSync(`./data/record.db${suffix}`);
  migrateDb();
  console.log(`Demo run · LLM mode: ${llmMode()} · model: ${llmModel()} · database: ${process.env.BLINK_DB_PATH}`);

  const gold = readFixtureJson<Gold>("cases", "halvorsen", "gold.json");
  const caseId = HALVORSEN_CASE_ID;
  const who = (id: string): Actor => loadActor(getDb(), `user_${id}`);

  // ── 1. Seed; the worker extracts facts from the six curated documents ─────
  heading("1. Seed and document facts");
  await seedDatabase();
  await runJobs("document facts");
  for (const doc of listDocuments(getDb())) {
    console.log(`   ${doc.id}: ${doc.factsStatus}, ${doc.facts.length} fact(s)`);
    check(doc.factsStatus === "extracted" && doc.facts.length > 0, `${doc.id} has extracted facts`);
  }
  if (reached("docfacts")) return finish();

  // ── 2. The broken policy must fail closed ─────────────────────────────────
  heading("2. Compile the broken policy");
  const dana = who("dana");
  const broken = transact((tx) => createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1-broken.md"), dana));
  transact((tx) => requestCompile(tx, broken.policyVersionId, dana));
  await runJobs("broken policy compile");
  const brokenDetail = policyDetail(getDb(), broken.policyVersionId);
  const brokenBlocking = brokenDetail.validation?.issues.filter((i) => i.severity === "blocking") ?? [];
  console.log(`   status ${brokenDetail.status}; blocking: ${[...new Set(brokenBlocking.map((i) => i.code))].join(", ") || "none"}`);
  for (const issue of brokenBlocking.slice(0, 6)) console.log(`     - ${issue.code}: ${issue.message.slice(0, 160)}`);
  check(brokenDetail.status === "COMPILE_FAILED", "broken policy ends COMPILE_FAILED");
  let approveRefused = false;
  try {
    transact((tx) => approvePolicy(tx, broken.policyVersionId, brokenDetail.bundleHash ?? "0".repeat(64), dana));
  } catch {
    approveRefused = true;
  }
  check(approveRefused, "the server refuses to approve it");
  if (reached("broken")) return finish();

  // ── 3. Compile, validate, and approve policy v1 ───────────────────────────
  heading("3. Compile policy v1");
  const v1 = transact((tx) => createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1.md"), dana));
  transact((tx) => requestCompile(tx, v1.policyVersionId, dana));
  await runJobs("policy v1 compile");
  const detail = policyDetail(getDb(), v1.policyVersionId);
  const blocking = detail.validation?.issues.filter((i) => i.severity === "blocking") ?? [];
  console.log(`   status ${detail.status}; attempts: ${detail.attempts.map((a) => `${a.stage}#${a.attemptNo}${a.issues.length ? `(${a.issues.length} issue)` : ""}`).join(" → ")}`);
  console.log(`   ${detail.validation?.totals.combinations} combinations across ${detail.validation?.totals.monitors} monitors; reviewer scenarios ${detail.scenarios?.reviewer?.passed}/${detail.scenarios?.reviewer?.total}; AI scenarios ${detail.scenarios?.ai ? `${detail.scenarios.ai.passed}/${detail.scenarios.ai.total}` : "—"}`);
  for (const rule of detail.rulesDoc?.rules ?? []) console.log(`     ${rule.rule_id} ← ${rule.source_clause_ids.join(",")} · on_true ${rule.on_true} · on_indeterminate ${rule.on_indeterminate} · ${rule.intent.slice(0, 90)}`);
  console.log(`   unsupported: ${(detail.rulesDoc?.unsupported_clauses ?? []).map((u) => u.clause_id).join(", ") || "none"}`);
  for (const issue of blocking) console.log(`     - ${issue.code}: ${issue.message.slice(0, 200)}`);
  for (const r of detail.scenarios?.reviewer?.results.filter((r) => !r.pass) ?? []) console.log(`     - scenario "${r.name}" failed: ${r.failures.join("; ")}`);
  check(detail.status === "VALIDATED", "policy v1 ends VALIDATED");
  if (detail.status !== "VALIDATED") return finish();
  transact((tx) => approvePolicy(tx, v1.policyVersionId, detail.bundleHash!, dana));
  check(policyDetail(getDb(), v1.policyVersionId).status === "ACTIVE", "approved by hash → ACTIVE");
  const paragraphOfRule = new Map<string, string[]>();
  for (const rule of detail.rulesDoc!.rules) paragraphOfRule.set(rule.rule_id, rule.source_clause_ids.map((id) => detail.inventory?.clauses.find((c) => c.clause_id === id)?.paragraph ?? "?"));
  if (reached("policy")) return finish();

  // ── 4. Upload transcript v1; extraction, quotes, comparison, evaluation ───
  heading("4. Analyze transcript v1");
  transact((tx) => uploadTranscript(tx, caseId, { text: readFixtureText("cases", "halvorsen", "transcript-v1.txt"), filename: "transcript-v1.txt", sourceLabel: "Meridian transcript v1", source: "ai" }, who("priya")));
  await runJobs("analysis of v1");
  const marcus = who("marcus");
  const jordan = who("jordan");
  let ws = loadWorkspace(getDb(), caseId, marcus);
  console.log(`   case ${ws.case.status}; run ${ws.run?.status}${ws.run?.error ? ` (${ws.run.error})` : ""}; ${ws.claims.length} claims`);
  for (const c of ws.claims) {
    const cmp = c.comparison ? ` · public: ${c.comparison.outcome}${c.comparison.reasons.length ? ` [${c.comparison.reasons.join(", ")}]` : ""}` : "";
    console.log(`     ${c.logicalKey} ${c.turnLabels.join("+")} · ${c.fields.subject_entity.kind}/${c.fields.scope} · basis ${c.fields.knowledge_basis} · access ${c.fields.access_timing} · period ${c.fields.period.relative}${c.fields.period.fiscal_quarter ? ` Q${c.fields.period.fiscal_quarter}` : ""}${cmp}`);
    console.log(`        ${c.fields.summary.slice(0, 150)}`);
  }
  const describe = (f: FindingView) => `${f.label} [${f.origin}] ${f.state} · ${f.turnLabels.join("+")} · rules ${f.rules.map((r) => `${r.ruleId}:${r.state}`).join(",") || "—"} · path ${f.path.map((p) => `${p.state}${p.turnLabel ? `@${p.turnLabel}` : ""}`).join("→")}${f.escalationRequired ? " · ESCALATION" : ""} · ${f.title}`;
  for (const f of ws.findings) console.log(`   ${describe(f)}`);
  for (const issue of ws.issues) console.log(`   issue ${issue.severity} ${issue.code}: ${issue.message.slice(0, 160)}`);

  const policyFindings = () => ws.findings.filter((f) => f.origin === "policy");
  const findingOn = (turns: string[]) => policyFindings().find((f) => turns.every((t) => f.turnLabels.includes(t)));
  for (const g of gold.findings) {
    const f = findingOn(g.turns);
    check(Boolean(f), `${g.id}: a finding links ${g.turns.join(" + ")}`);
    if (!f) continue;
    check(f.state === g.expect_state, `${g.id}: state ${g.expect_state} (got ${f.state})`);
    const wanted = g.expect_state === "NEEDS_CONTEXT" ? "NEEDS_CONTEXT" : "REVIEW_REQUIRED";
    const paragraphs = new Set(f.rules.filter((r) => r.state === wanted).flatMap((r) => paragraphOfRule.get(r.ruleId) ?? []));
    for (const rule of g.rules) check(paragraphs.has(GOLD_RULE_PARAGRAPH[rule]), `${g.id}: the rule for ${GOLD_RULE_PARAGRAPH[rule]} (gold ${rule}) is ${wanted}`);
    if (g.escalation) check(f.escalationRequired, `${g.id}: escalation required`);
    if (g.expect_history) check(JSON.stringify(f.path.map((p) => p.state)) === JSON.stringify(g.expect_history), `${g.id}: history ${g.expect_history.join(" → ")} (got ${f.path.map((p) => p.state).join(" → ")})`);
  }
  for (const n of gold.non_findings) check(!policyFindings().some((f) => f.primaryTurnLabel === n.turns[0]), `no policy finding on ${n.turns[0]} (${n.why})`);
  check(policyFindings().length === gold.findings.length, `exactly ${gold.findings.length} policy findings (got ${policyFindings().length})`);
  for (const c of gold.comparisons) {
    const claim = ws.claims.find((x) => x.turnLabels.includes(c.turn) && x.comparison);
    check(claim?.comparison?.outcome === c.expect && JSON.stringify(claim.comparison.reasons) === JSON.stringify(c.reasons ?? []), `comparison at ${c.turn}: ${c.expect}${c.reasons ? ` [${c.reasons.join(", ")}]` : ""} (got ${claim?.comparison?.outcome ?? "none"} [${claim?.comparison?.reasons.join(", ") ?? ""}])`);
  }
  const quotes = (ws.run?.report as { stats?: { proposedQuotes: number; validQuotes: number } } | null)?.stats;
  if (quotes) check(quotes.validQuotes === quotes.proposedQuotes, `every proposed quote resolves (${quotes.validQuotes}/${quotes.proposedQuotes})`);
  if (reached("extract") || problems.length > 0) return finish();

  // ── 5. The review: clarification, dispositions, escalation, attestation ───
  heading("5. Review");
  const act = (findingId: string, input: { type: "DISPOSE"; outcome: "cleared_for_research" | "restricted_exclude" | "restricted_escalate_to_legal" | "no_concern" } | { type: "ESCALATE" }, actor: Actor) =>
    transact((tx) => applyFindingAction(tx, findingId, { ...input, rationale: RATIONALE, expectedVersion: getFinding(tx, findingId).version }, actor));

  const g3 = findingOn(["T17"])!;
  const contextTask = g3.tasks.find((t) => t.kind === "context" && t.status === "open");
  check(Boolean(contextTask), "F3 (margins) has an open context task");
  if (contextTask) {
    transact((tx) => answerTask(tx, contextTask.id, { answer: "Expert confirms it reflects Halvorsen's public Q1 earnings-call commentary.", fieldMapping: { knowledge_basis: "public_source" }, expectedVersion: contextTask.version }, marcus));
    ws = loadWorkspace(getDb(), caseId, marcus);
    check(findingOn(["T17"])!.state === "NOT_TRIGGERED_PENDING_ACK", `after the clarification F3 is NOT_TRIGGERED_PENDING_ACK (got ${findingOn(["T17"])!.state})`);
    act(g3.id, { type: "DISPOSE", outcome: "no_concern" }, marcus);
  }
  act(findingOn(["T15"])!.id, { type: "DISPOSE", outcome: "restricted_exclude" }, marcus);
  const g1 = findingOn(["T5", "T11"])!;
  let reviewerBlocked = false;
  try {
    act(g1.id, { type: "DISPOSE", outcome: "restricted_exclude" }, marcus);
  } catch {
    reviewerBlocked = true;
  }
  check(reviewerBlocked, "a reviewer cannot dispose F1");
  act(g1.id, { type: "DISPOSE", outcome: "restricted_escalate_to_legal" }, jordan);
  ws = loadWorkspace(getDb(), caseId, marcus);
  for (const f of ws.findings.filter((f) => f.origin === "ai_suggested" && f.state !== "DISPOSITIONED")) {
    console.log(`   dismissing AI-suggested ${f.label}: ${f.title}`);
    act(f.id, { type: "DISPOSE", outcome: "no_concern" }, marcus);
  }
  transact((tx) => attestCase(tx, caseId, { transcriptVersionId: currentTranscript(tx, caseId)!.id }, marcus));
  check(getCase(getDb(), caseId).status === "READY_FOR_APPROVAL", `case READY_FOR_APPROVAL (got ${getCase(getDb(), caseId).status})`);
  if (reached("review") || problems.length > 0) return finish();

  // ── 6. Brief: draft from eligible claims, approve the hash, release ───────
  heading("6. Brief v1");
  const draftApproveRelease = async (label: string) => {
    transact((tx) => requestBriefDraft(tx, caseId, "ai", marcus));
    await runJobs(`brief draft (${label})`);
    const brief = latestBrief(getDb(), caseId);
    if (!brief) {
      check(false, `${label}: a brief was drafted`);
      return null;
    }
    const view = briefWorkspace(getDb(), caseId, marcus);
    console.log(`   brief v${brief.versionNo}: ${view.brief!.sections.reduce((n, s) => n + s.sentences.length, 0)} sentences, ${view.brief!.citations.length} cited claims, ${view.brief!.dropped.length} dropped, ${brief.withheldCount} withheld`);
    console.log(brief.bodyMd.split("\n").map((l) => `     ${l}`).join("\n"));
    check(view.brief!.dropped.length === 0, `${label}: no sentence was dropped for a missing or ineligible citation`);
    transact((tx) => approveBrief(tx, brief.id, { briefHash: brief.contentHash, audience: "analyst", expectedVersion: brief.version }, marcus));
    const result = transact((tx) => releaseBrief(tx, brief.id, { audience: "analyst", expectedVersion: getBrief(tx, brief.id).version }, marcus));
    check(result.released, `${label}: release succeeds${result.released ? "" : ` (${result.failures.map((f) => f.code).join(", ")})`}`);
    return brief;
  };
  const brief1 = await draftApproveRelease("v1");
  if (!brief1) return finish();
  check(brief1.withheldCount === 2, `"2 statements withheld" (got ${brief1.withheldCount})`);
  const analystView = JSON.stringify(releasedBriefs(getDb(), who("priya")));
  check(!/Cardinal/.test(analystView) && !/dashboard/i.test(analystView), "the analyst view contains neither restricted statement");
  if (reached("brief") || problems.length > 0) return finish();

  // ── 7. Transcript v2: only what depended on T19 reopens ───────────────────
  heading("7. Transcript v2 (T19 corrected)");
  transact((tx) => uploadTranscript(tx, caseId, { text: readFixtureText("cases", "halvorsen", "transcript-v2.txt"), filename: "transcript-v2.txt", sourceLabel: "Meridian transcript v2 (corrected)", source: "ai" }, who("priya")));
  await runJobs("analysis of v2");
  ws = loadWorkspace(getDb(), caseId, marcus);
  const report = ws.run?.report as { claims?: { created: string[]; revised: string[]; carried: string[]; retired: string[] }; stale?: string[] } | null;
  console.log(`   claims: created [${report?.claims?.created.join(", ")}] revised [${report?.claims?.revised.join(", ")}] retired [${report?.claims?.retired.join(", ")}] carried ${report?.claims?.carried.length}`);
  console.log(`   stale: ${report?.stale?.join(" | ") || "none"}`);
  for (const f of ws.findings) console.log(`   ${describe(f)}`);
  check((report?.claims?.revised.length ?? 0) === 1 && (report?.claims?.created.length ?? 0) === 0 && (report?.claims?.retired.length ?? 0) === 0, "exactly one claim (the T19 statement) was revised; none created or retired");
  check(ws.findings.every((f) => f.state === "DISPOSITIONED" && f.decisions.every((d) => !d.stale)), "every finding decision is still valid");
  const blocked = transact((tx) => releaseBrief(tx, brief1.id, { audience: "analyst", expectedVersion: getBrief(tx, brief1.id).version }, marcus));
  const messages = blocked.released ? [] : blocked.failures.map((f) => f.message);
  for (const m of messages) console.log(`     ✗ ${m}`);
  check(messages.some((m) => /^approval stale: claim changed \(.*T19\)$/.test(m)), 'release blocked: "approval stale: claim changed (… T19)"');
  check(messages.includes("attestation stale: transcript v2"), 'release blocked: "attestation stale: transcript v2"');
  if (reached("v2") || problems.length > 0) return finish();

  // ── 8. Re-attest, redraft, approve, release ───────────────────────────────
  heading("8. Re-attest and release brief v2");
  transact((tx) => attestCase(tx, caseId, { transcriptVersionId: currentTranscript(tx, caseId)!.id }, marcus));
  const brief2 = await draftApproveRelease("v2");
  if (brief2) check(/twenty-one|21/.test(brief2.bodyMd), "brief v2 carries the corrected figure");
  const chain = verifyAuditChain(getDb());
  check(chain.ok, `audit chain verifies (${chain.count} events)`);
  return finish();
}

function finish() {
  heading("Summary");
  const calls = getDb().select().from(llmCalls).all();
  const live = calls.filter((c) => !c.replayed);
  // Sum the calls that have a listed price, and say how many had none: an unknown cost is never counted as zero.
  const cost = (rows: typeof calls) => {
    let usd = 0;
    let unpriced = 0;
    for (const c of rows) {
      const one = costUsd({ input_tokens: c.inputTokens, output_tokens: c.outputTokens, cache_read_input_tokens: c.cacheReadTokens, cache_creation_input_tokens: c.cacheCreationTokens }, c.model);
      if (one === null) unpriced++;
      else usd += one;
    }
    return `$${usd.toFixed(2)}${unpriced > 0 ? ` + ${unpriced} call(s) with no listed price` : ""}`;
  };
  console.log(`   ${calls.length} model call(s): ${live.length} live (${cost(live)}), ${calls.length - live.length} replayed (recorded cost ${cost(calls.filter((c) => c.replayed))})`);
  if (problems.length === 0) console.log("   All checks passed.");
  else {
    console.log(`   ${problems.length} check(s) failed:`);
    for (const p of problems) console.log(`     ✗ ${p}`);
  }
  closeDb();
  process.exitCode = problems.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
