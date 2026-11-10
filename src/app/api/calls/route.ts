/** POST /api/calls — the banker starts a live call on their own case. */
import { transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { StartCallSchema, startCall } from "@/server/services/live";

export const POST = api(async ({ actor, body }) => {
  const input = await body(StartCallSchema);
  const call = transact((tx) => startCall(tx, input, actor));
  return reply(201, { call: { id: call.id, status: call.status, startedAt: call.startedAt } });
});
