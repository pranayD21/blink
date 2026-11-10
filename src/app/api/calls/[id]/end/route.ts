/** POST /api/calls/:id/end — end the call into the after-call read, once speech still being read is stored. */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { z } from "zod";
import { endCall, turnsSettled } from "@/server/services/live";

const EndSchema = z.strictObject({});

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  await body(EndSchema);
  // Speech already posted must be read before the call closes, or its flags would be lost.
  await turnsSettled(params.id);
  // Never `{ source: "gold" }` here: hand-labeled claims are not something a request may ask for.
  return transact((tx) => endCall(tx, params.id, actor));
});
