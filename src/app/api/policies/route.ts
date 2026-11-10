/** GET /api/policies — versions; POST /api/policies — create source text + draft version (policy owner). */
import { getDb, transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { CreatePolicySchema, createPolicy, listPolicyVersions } from "@/server/services/policies";

export const GET = api(() => ({ versions: listPolicyVersions(getDb()) }));

export const POST = api(async ({ actor, body }) => {
  const input = await body(CreatePolicySchema);
  return reply(201, transact((tx) => createPolicy(tx, input, actor)));
});
