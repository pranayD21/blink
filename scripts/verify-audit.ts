/** pnpm audit:verify — recomputes the audit hash chain and reports the first broken sequence number. */
import { verifyAuditChain } from "../src/server/audit/log";
import { closeDb, getDb } from "../src/server/db/client";
import { loadEnv } from "../src/server/env";

loadEnv();
const result = verifyAuditChain(getDb());
if (result.ok) {
  console.log(`Audit chain OK: ${result.count} events, head ${result.headHash.slice(0, 16)}…`);
} else {
  console.error(`Audit chain BROKEN at seq ${result.brokenSeq}: ${result.reason} (${result.count} events checked)`);
  process.exitCode = 1;
}
closeDb();
