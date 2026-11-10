/**
 * POST /api/briefs/:id/release — the release check (§12.4). A failed check is
 * a 409 that lists every failure, so the UI can show the whole checklist.
 */
import { transact } from "@/server/db/client";
import { api, errorBody, reply } from "@/server/http/route";
import { ReleaseSchema, releaseBrief } from "@/server/services/release";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(ReleaseSchema);
  // The transaction commits either way: a blocked attempt records the staleness it found and an audit event.
  const result = transact((tx) => releaseBrief(tx, params.id, input, actor));
  if (!result.released) {
    return reply(409, errorBody("RELEASE_CHECK_FAILED", `the release check failed on ${result.failures.length} condition${result.failures.length === 1 ? "" : "s"}`, { failures: result.failures }));
  }
  return result;
});
