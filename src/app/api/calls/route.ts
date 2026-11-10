/**
 * POST /api/calls — the banker starts a live call on their own case.
 * GET /api/calls — how the live path is doing across every call: compliance and the policy owner; a banker gets 403.
 */
import { getDb, transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { StartCallSchema, startCall } from "@/server/services/live";
import { callsOverview } from "@/server/services/observability";

export const POST = api(async ({ actor, body }) => {
  const input = await body(StartCallSchema);
  const call = transact((tx) => startCall(tx, input, actor));
  return reply(201, { call: { id: call.id, status: call.status, startedAt: call.startedAt } });
});

export const GET = api(({ actor }) => callsOverview(getDb(), actor));
