/**
 * Compiles the three published firm policies (spec section 11, Task 36) with
 * Blink's own compiler, in a scratch database, as the policy owner would.
 *
 *   BLINK_LLM_MODE=record pnpm eval:policies    record what is missing (calls the API)
 *   BLINK_LLM_MODE=replay pnpm eval:policies    the same results from the recordings, no network
 *
 * For each policy it prints the status, the compile attempts, the rules, the
 * clauses the predicates cannot express and the validator's blocking issues,
 * and writes the result to fixtures/real/policies/<name>.compiled.json for
 * `loadRealPolicy`. A policy that does not validate is reported as it is.
 *
 * Exit code: 0 when every policy either validated or failed with validator
 * issues; 1 on anything else (a refused or truncated model call, a replay
 * miss, a failed job, a crash).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { sha256Hex } from "../src/core/deps/hash";
import { DEMO_USERS, loadActor } from "../src/server/auth/actor";
import { closeDb, getDb, migrateDb, transact } from "../src/server/db/client";
import { jobs, llmCalls, users } from "../src/server/db/schema";
import { loadEnv } from "../src/server/env";
import { REAL_POLICIES, type RealPolicyBundle, realPolicyBundlePath, realPolicyText, realPolicyTitle } from "../src/server/eval/real";
import { drainJobs } from "../src/server/jobs/runner";
import { costUsd, llmMode, llmModel } from "../src/server/llm/client";
import { createPolicy, policyDetail, requestCompile } from "../src/server/services/policies";

const OWNER = DEMO_USERS.find((u) => u.role === "policy_owner")!;
const heading = (text: string) => console.log(`\n── ${text} ${"─".repeat(Math.max(0, 70 - text.length))}`);
const one = (s: string) => s.replace(/\s+/g, " ").trim();

function countBy<T>(items: readonly T[], key: (t: T) => string): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k} ${n}`).join(", ");
}

async function compileOne(name: string, requiredParagraphs: string[]): Promise<{ bundle: RealPolicyBundle; problem: string | null }> {
  const text = realPolicyText(name);
  const title = realPolicyTitle(name);
  const owner = loadActor(getDb(), OWNER.id);
  const { policyVersionId } = transact((tx) => createPolicy(tx, { title, text, requiredParagraphs }, owner));
  transact((tx) => requestCompile(tx, policyVersionId, owner));
  await drainJobs();
  const failedJobs = getDb().select().from(jobs).where(eq(jobs.status, "failed")).all();
  const d = policyDetail(getDb(), policyVersionId);

  const issues = d.validation?.issues ?? [];
  const blocking = issues.filter((i) => i.severity === "blocking");
  const compileError = d.validation?.compileError ?? null;
  const clauses = d.inventory?.clauses ?? [];
  const paragraphOf = new Map(clauses.map((c) => [c.clause_id, c.paragraph]));
  const paragraphsOf = (ids: string[]) => [...new Set(ids.map((id) => paragraphOf.get(id) ?? "?"))].join(",");

  heading(`${name}: ${title}`);
  console.log(`   status ${d.status}; attempts: ${d.attempts.map((a) => `${a.stage}#${a.attemptNo}${a.issues.length ? ` (${a.issues.length} issue${a.issues.length > 1 ? "s" : ""})` : ""}`).join(" → ") || "none"}`);
  console.log(`   ${d.source.paragraphs.length} paragraphs; required: ${requiredParagraphs.join(", ")}`);
  console.log(`   clauses found: ${clauses.length}${clauses.length ? ` (${countBy(clauses, (c) => c.kind)})` : ""}`);
  const rules = d.rulesDoc?.rules ?? [];
  console.log(`   rules written: ${rules.length}`);
  for (const r of rules) console.log(`     ${r.rule_id} ← ${r.source_clause_ids.join(",")} (${paragraphsOf(r.source_clause_ids)}) · on_true ${r.on_true} · on_indeterminate ${r.on_indeterminate} · ${one(r.intent)}`);
  const unsupported = d.rulesDoc?.unsupported_clauses ?? [];
  console.log(`   clauses the predicates cannot express: ${unsupported.length}`);
  for (const u of unsupported) console.log(`     ${u.clause_id} (${paragraphOf.get(u.clause_id) ?? "?"}): ${one(u.reason)}`);
  if (d.validation) console.log(`   validation: ${blocking.length} blocking, ${issues.length - blocking.length} warning(s); ${d.validation.totals.monitors} monitors, ${d.validation.totals.combinations} combinations`);
  for (const i of blocking) console.log(`     - ${i.code}: ${one(i.message)}`);
  const ai = d.scenarios?.ai;
  console.log(`   AI scenarios: ${ai ? `${ai.passed}/${ai.total} passed` : "not run"}`);
  if (compileError) console.log(`   ! compile error ${compileError.code}: ${one(compileError.message)}`);
  for (const job of failedJobs) console.log(`   ! job ${job.type} failed: ${job.error}`);

  const bundle: RealPolicyBundle = {
    name,
    title,
    sourceTextHash: sha256Hex(text.replace(/\r\n?/g, "\n")),
    requiredParagraphs,
    status: d.status as RealPolicyBundle["status"],
    bundleHash: d.bundleHash,
    attempts: d.attempts.map((a) => ({ stage: a.stage, attemptNo: a.attemptNo, issues: a.issues.map((i) => i.code) })),
    compileError,
    issues,
    inventory: d.inventory,
    rulesDoc: d.rulesDoc,
    monitors: d.monitors,
  };
  writeFileSync(realPolicyBundlePath(name), `${JSON.stringify(bundle, null, 2)}\n`);

  let problem: string | null = null;
  if (failedJobs.length > 0) problem = `${name}: ${failedJobs.length} job(s) failed`;
  else if (compileError) problem = `${name}: the compile could not run (${compileError.code})`;
  else if (d.status === "COMPILE_FAILED" && blocking.length === 0) problem = `${name}: COMPILE_FAILED with no validator issue listed`;
  else if (d.status !== "VALIDATED" && d.status !== "COMPILE_FAILED") problem = `${name}: ended ${d.status}`;
  // Failed jobs are counted per policy, so clear them before the next one.
  for (const job of failedJobs) getDb().delete(jobs).where(eq(jobs.id, job.id)).run();
  return { bundle, problem };
}

function spend(): string {
  const calls = getDb().select().from(llmCalls).all();
  const live = calls.filter((c) => !c.replayed);
  const cost = (rows: typeof calls) => {
    // An unknown price is reported as unknown, never as zero.
    let usd = 0;
    let unpriced = 0;
    for (const c of rows) {
      const usdOne = costUsd({ input_tokens: c.inputTokens, output_tokens: c.outputTokens, cache_read_input_tokens: c.cacheReadTokens, cache_creation_input_tokens: c.cacheCreationTokens }, c.model);
      if (usdOne === null) unpriced++;
      else usd += usdOne;
    }
    return `$${usd.toFixed(2)}${unpriced > 0 ? ` + ${unpriced} call(s) with no listed price` : ""}`;
  };
  return `${calls.length} model call(s): ${live.length} live (${cost(live)}), ${calls.length - live.length} replayed (recorded cost ${cost(calls.filter((c) => c.replayed))})`;
}

async function main() {
  loadEnv();
  const scratch = mkdtempSync(join(tmpdir(), "blink-real-policies-"));
  process.env.BLINK_DB_PATH = join(scratch, "scratch.db");
  try {
    migrateDb();
    transact((tx) => tx.insert(users).values({ ...OWNER, email: null, passwordHash: null }).run());
    console.log(`Real policies · LLM mode: ${llmMode()} · model: ${llmModel()}`);

    const results: { bundle: RealPolicyBundle; problem: string | null }[] = [];
    for (const p of REAL_POLICIES) results.push(await compileOne(p.name, p.requiredParagraphs));

    heading("Summary");
    for (const { bundle: b } of results) {
      const blocking = b.issues.filter((i) => i.severity === "blocking");
      console.log(`   ${b.name}: ${b.status}; ${b.inventory?.clauses.length ?? 0} clauses, ${b.rulesDoc?.rules.length ?? 0} rules, ${b.rulesDoc?.unsupported_clauses.length ?? 0} unsupported; ${blocking.length} blocking${blocking.length ? ` (${[...new Set(blocking.map((i) => i.code))].join(", ")})` : ""}`);
    }
    console.log(`   ${spend()}`);
    const problems = results.map((r) => r.problem).filter((p): p is string => p !== null);
    for (const p of problems) console.log(`   ✗ ${p}`);
    process.exitCode = problems.length === 0 ? 0 : 1;
  } finally {
    closeDb();
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
