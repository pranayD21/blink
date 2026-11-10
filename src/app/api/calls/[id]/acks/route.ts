/** POST /api/calls/:id/acks — when the decision for a turn arrived and when the pill showed it. */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { AckSchema, ackTurn } from "@/server/services/live";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(AckSchema);
  transact((tx) => ackTurn(tx, params.id, input, actor));
  return { ok: true };
});
