/** POST /api/calls/:id/outages — a stage of the live path that was down. */
import { transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { OutageSchema, recordOutage } from "@/server/services/live";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(OutageSchema);
  return reply(201, transact((tx) => recordOutage(tx, params.id, input, actor)));
});
