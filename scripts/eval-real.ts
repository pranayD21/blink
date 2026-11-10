/**
 * Scores Blink on real calls (spec section 11, Task 37): each call in a set runs
 * through the after-call pipeline under each policy, in a scratch database, and
 * every labelled turn is counted as hidden, not extracted, or extracted but not
 * flagged (with or without a covering clause, from coverage-<policy>.json).
 *
 *   BLINK_LLM_MODE=live pnpm eval:real --set fixtures/real/dev --policies oaktree,sage-rock,tcw,demo
 *   pnpm eval:real --set a --set b         several sets in one run
 *   --calls chu,kyprios-1                   only these calls
 *   --counts-only                           numbers, ids and turn labels only; never a word of transcript
 *   --repeat 5                              run everything n times (fresh model calls each time)
 *   --out <file>                            where to write the scores as JSON (default data/real-eval/<time>.json)
 *
 * Real material must never be recorded into fixtures/llm-recordings: record mode is refused unless
 * BLINK_RECORDINGS_DIR points somewhere git-ignored. Live mode writes no recordings at all.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { closeDb, getDb, migrateDb } from "../src/server/db/client";
import { llmCalls } from "../src/server/db/schema";
import { loadEnv } from "../src/server/env";
import { DEMO_POLICY, REAL_POLICIES, type RealCaseScore, realCallsIn, repeatAgreement, runRealEval } from "../src/server/eval/real";
import { RECORDINGS_DIR, costUsd, llmMode, llmModel } from "../src/server/llm/client";

function args(argv: string[]) {
  const all = (flag: string) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
  const one = (flag: string) => all(flag).at(-1);
  const sets = all("--set").map((s) => resolve(s.replace(/^~(?=\/|$)/, homedir())));
  if (sets.length === 0) throw new Error("give at least one --set <dir>");
  const repeat = Number(one("--repeat") ?? "1");
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("--repeat must be a whole number of at least 1");
  return {
    sets,
    policies: (one("--policies") ?? [...REAL_POLICIES.map((p) => p.name), DEMO_POLICY].join(",")).split(",").filter(Boolean),
    calls: one("--calls")?.split(",").filter(Boolean),
    countsOnly: argv.includes("--counts-only"),
    repeat,
    out: one("--out"),
  };
}

function spend(): string {
  const calls = getDb().select().from(llmCalls).all();
  const live = calls.filter((c) => !c.replayed);
  let usd = 0;
  let unpriced = 0;
  for (const c of live) {
    const one = costUsd({ input_tokens: c.inputTokens, output_tokens: c.outputTokens, cache_read_input_tokens: c.cacheReadTokens, cache_creation_input_tokens: c.cacheCreationTokens }, c.model);
    if (one === null) unpriced++;
    else usd += one;
  }
  // An unknown price is reported as unknown, never as zero.
  return `${calls.length} model call(s), ${live.length} live: $${usd.toFixed(2)}${unpriced > 0 ? ` + ${unpriced} call(s) with no listed price` : ""}`;
}

function totals(scores: RealCaseScore[], policy: string): string {
  const mine = scores.filter((s) => s.policy === policy && !s.error);
  const sum = (f: (s: RealCaseScore) => number) => mine.reduce((n, s) => n + f(s), 0);
  const nf = (c: boolean | null) => sum((s) => s.extractedNotFlagged.filter((t) => t.covered === c).length);
  const errors = scores.filter((s) => s.policy === policy && s.error).length;
  return `${policy}${policy === DEMO_POLICY ? " (comparison only)" : ""}: labelled ${sum((s) => s.labelled)} · hidden ${sum((s) => s.hidden)} · not extracted ${sum((s) => s.notExtracted.length)} · not flagged, covered ${nf(true)} · not covered ${nf(false)} · not judged ${nf(null)} · other hidden ${sum((s) => s.otherHidden)}${errors ? ` · ${errors} could not run` : ""}`;
}

async function main() {
  loadEnv();
  const opts = args(process.argv.slice(2));
  const recordings = RECORDINGS_DIR();
  if (llmMode() === "record" && recordings.startsWith(resolve(process.cwd(), "fixtures"))) {
    throw new Error("record mode would write real material into fixtures/; set BLINK_RECORDINGS_DIR to a git-ignored folder such as data/real-recordings, or run live");
  }
  const scratch = mkdtempSync(join(tmpdir(), "blink-real-eval-"));
  process.env.BLINK_DB_PATH = join(scratch, "scratch.db");
  try {
    migrateDb();
    console.log(`Real calls · LLM mode: ${llmMode()} · model: ${llmModel()} · policies: ${opts.policies.join(", ")}${opts.repeat > 1 ? ` · ${opts.repeat} runs` : ""}${opts.countsOnly ? " · counts only" : ""}`);
    const missing = (opts.calls ?? []).filter((c) => !opts.sets.some((dir) => realCallsIn(dir).includes(c)));
    if (missing.length > 0) throw new Error(`no set has the call(s) ${missing.join(", ")}`);
    const scores: RealCaseScore[] = [];
    for (let run = 1; run <= opts.repeat; run++) {
      for (const dir of opts.sets) {
        // With several sets, --calls names calls across all of them; each set runs the ones it has.
        const calls = opts.calls?.filter((c) => realCallsIn(dir).includes(c));
        if (calls && calls.length === 0) continue;
        // A set is printed by its last two folder names only, so a private set's full location stays off the screen.
        console.log(`\n── run ${run} · set ${dir.split("/").slice(-2).join("/")}`);
        scores.push(...(await runRealEval({ dir, policies: opts.policies, countsOnly: opts.countsOnly, calls, run })));
      }
    }

    console.log("\n── Totals (counts, not percentages)");
    for (const p of opts.policies) console.log(`   ${totals(scores, p)}`);
    if (opts.repeat > 1) {
      console.log("\n── Repeat runs: the same hidden turns on how many runs");
      for (const r of repeatAgreement(scores)) console.log(`   ${r.id} · ${r.policy}: ${r.agreeing} of ${r.runs} gave [${r.modal.join(",") || "none"}]${r.errors ? ` · ${r.errors} could not run` : ""} · ${r.agreeing >= Math.ceil((r.runs * 4) / 5) ? "stable" : "not stable"}`);
    }
    console.log(`\n   ${spend()}`);

    const out = resolve(opts.out ?? join("data", "real-eval", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify({ mode: llmMode(), model: llmModel(), policies: opts.policies, repeat: opts.repeat, scores }, null, 2)}\n`);
    console.log(`   scores written to ${out.replace(`${process.cwd()}/`, "")}`);
    process.exitCode = scores.some((s) => s.error) ? 1 : 0;
  } finally {
    closeDb();
    rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  closeDb();
  process.exit(1);
});
