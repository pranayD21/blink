/**
 * pnpm db:reset → drizzle-kit migrate → this script.
 *
 *   tsx scripts/seed.ts                           demo start: users, documents, the Halvorsen case
 *   tsx scripts/seed.ts --manual-policy           also activate the labeled manual fallback policy
 *   tsx scripts/seed.ts --manual-policy --gold    also upload transcript v1 with hand-labeled claims (no model)
 */
import { closeDb } from "../src/server/db/client";
import { loadEnv } from "../src/server/env";
import { countQueued } from "../src/server/jobs/queue";
import { getDb } from "../src/server/db/client";
import { seedDatabase } from "../src/server/services/seed";

async function main() {
  loadEnv();
  const args = new Set(process.argv.slice(2));
  const options = { manualPolicy: args.has("--manual-policy"), gold: args.has("--gold") };
  const result = await seedDatabase(options);
  const queued = countQueued(getDb());
  console.log(`Seeded ${process.env.BLINK_DB_PATH ?? "./data/blink.db"}`);
  console.log(`  users: Priya Raman (analyst), Marcus Lee (reviewer), Jordan Ellis (senior reviewer), Dana Okafor (policy owner)`);
  console.log(`  case:  ${result.caseId} — Halvorsen Pumps (synthetic)`);
  if (result.policyVersionId) console.log(`  policy: manual fallback activated (${result.policyVersionId})`);
  if (options.gold) console.log("  transcript v1 uploaded with hand-labeled claims (no model call)");
  if (queued > 0) console.log(`  ${queued} job(s) queued for the worker (document facts). Start it with: pnpm dev`);
  closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
