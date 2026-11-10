/** POST /api/cases/:id/session — review-timer heartbeat while a reviewer is active on the case. */
import { z } from "zod";
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { heartbeat } from "@/server/services/sessions";

const Schema = z.strictObject({ mode: z.enum(["blink", "baseline"]).default("blink") });

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const { mode } = await body(Schema);
  return transact((tx) => heartbeat(tx, params.id, actor, mode));
});
