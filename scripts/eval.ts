/**
 * pnpm eval — extraction on Halvorsen + V1–V8, scored against the hand-written
 * expectations, printed as a table and stored for the metrics page (§18.3).
 *
 *   BLINK_LLM_MODE=replay pnpm eval      offline, from recordings
 *   BLINK_LLM_MODE=record pnpm eval      calls the API for anything not yet recorded
 *   pnpm eval --only V3,V6               a subset
 *   pnpm eval --no-store                 do not write the result to the database
 *   pnpm eval --quiet                    one summary line (used by db:reset)
 */
import { closeDb, migrateDb, transact } from "../src/server/db/client";
import { loadEnv } from "../src/server/env";
import { runEval } from "../src/server/eval/run";
import { newId } from "../src/server/ids";
import { llmMode, llmModel } from "../src/server/llm/client";
import { saveEvalRun } from "../src/server/services/metrics";

const pct = (n: number | null) => (n === null ? "  —" : `${Math.round(n * 100)}%`.padStart(4));
const pad = (s: string | number, n: number) => String(s).padEnd(n);

async function main() {
  loadEnv();
  const args = process.argv.slice(2);
  const onlyAt = args.indexOf("--only");
  const only = onlyAt > -1 ? args[onlyAt + 1].split(",") : undefined;
  const quiet = args.includes("--quiet");
  migrateDb();
  // In quiet mode only the summary line is printed.
  const realLog = console.log;
  if (quiet) console.log = () => undefined;

  console.log(`Blink eval · LLM mode: ${llmMode()} · model: ${llmModel()}`);
  console.log("Policy and document facts are the hand-written fixtures, so the score reflects extraction only.\n");
  console.log(`${pad("fixture", 11)}${pad("claims", 8)}${pad("quotes", 9)}${pad("expected", 10)}${pad("matched", 9)}${pad("extra", 7)}${pad("recall", 8)}${pad("precision", 11)}assertions`);
  console.log("─".repeat(84));

  const result = await runEval({
    only,
    onFixture(f) {
      if (f.status === "error") {
        console.log(`${pad(f.id, 11)}ERROR  ${f.error}`);
        return;
      }
      console.log(`${pad(f.id, 11)}${pad(f.claims, 8)}${pad(`${f.quotes.valid}/${f.quotes.proposed}`, 9)}${pad(f.expectedFindings, 10)}${pad(f.matchedFindings, 9)}${pad(f.extraFindings, 7)}${pad(pct(f.recall), 8)}${pad(pct(f.precision), 11)}${f.assertionsTotal > 0 ? `${f.assertionsPassed}/${f.assertionsTotal}` : "—"}`);
      for (const m of f.missed) console.log(`           missed: ${m}`);
      for (const x of f.extra) console.log(`           extra: ${x}`);
      for (const s of f.stateMismatches) console.log(`           mismatch: ${s}`);
      for (const a of f.assertionFailures) console.log(`           assertion: ${a}`);
      for (const c of f.comparisons ?? []) if (!c.ok) console.log(`           comparison at ${c.turn}: expected ${c.expected}, got ${c.actual ?? "none"}`);
    },
  });

  const scored = result.fixtures.filter((f) => f.status === "scored");
  const expected = scored.reduce((n, f) => n + f.expectedFindings, 0);
  const matched = scored.reduce((n, f) => n + f.matchedFindings, 0);
  const extra = scored.reduce((n, f) => n + f.extraFindings, 0);
  const quotes = scored.reduce((n, f) => ({ valid: n.valid + f.quotes.valid, proposed: n.proposed + f.quotes.proposed }), { valid: 0, proposed: 0 });
  console.log("─".repeat(84));
  console.log(`Counts across ${scored.length} fixtures: ${matched} of ${expected} expected findings found, ${extra} extra; ${quotes.valid} of ${quotes.proposed} quotes valid.`);
  const errors = result.fixtures.filter((f) => f.status === "error").length;
  if (errors > 0) console.log(`${errors} fixture(s) could not run.`);
  console.log("Synthetic fixtures. These numbers show the measurement works. They are not production accuracy.");

  if (!args.includes("--no-store")) {
    transact((tx) => saveEvalRun(tx, newId("eval"), result.generatedAt, result));
    console.log("\nStored for the metrics page.");
  }
  console.log = realLog;
  if (quiet) console.log(`  eval (${llmMode()}): ${matched} of ${expected} expected findings found, ${extra} extra, across ${scored.length} fixtures${errors > 0 ? `; ${errors} could not run` : ""}`);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  closeDb();
  process.exit(1);
});
