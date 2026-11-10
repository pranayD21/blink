/** POST /api/cases/:id/analyze — re-run analysis on the current transcript as a new run (reviewer). */
import { z } from "zod";
import { transact } from "@/server/db/client";
import { forbidden } from "@/server/errors";
import { api, reply } from "@/server/http/route";
import { requestReanalysis } from "@/server/services/transcripts";

const Schema = z.strictObject({ source: z.enum(["ai", "gold"]).default("ai") });

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const { source } = await body(Schema);
  if (source === "gold" && process.env.NODE_ENV === "production" && process.env.BLINK_ALLOW_GOLD !== "1") throw forbidden("hand-labeled claims can only be loaded in development");
  return reply(202, transact((tx) => requestReanalysis(tx, params.id, actor, source)));
});
