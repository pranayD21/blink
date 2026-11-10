/** POST /api/cases/:id/session — review-timer heartbeat while a reviewer is active on the case. */
import { z } from "zod";
import { requireReviewer } from "@/server/auth/actor";
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { getCase } from "@/server/services/loaders";
import { heartbeat } from "@/server/services/sessions";

const Schema = z.strictObject({ mode: z.enum(["blink", "baseline"]).default("blink") });

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const { mode } = await body(Schema);
  requireReviewer(actor);
  return transact((tx) => {
    getCase(tx, params.id);
    return heartbeat(tx, params.id, actor, mode);
  });
});
