/** POST /api/briefs/:id/approve — approve this exact hash for one audience (reviewer). */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { ApproveBriefSchema, approveBrief } from "@/server/services/briefs";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(ApproveBriefSchema);
  return transact((tx) => approveBrief(tx, params.id, input, actor));
});
