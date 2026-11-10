/** GET /api/cases/:id/briefs — the brief workspace; POST — draft a brief (reviewer). */
import { getDb, transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { DraftBriefSchema, briefWorkspace, requestBriefDraft } from "@/server/services/briefs";

export const GET = api<{ id: string }>(({ params, actor }) => briefWorkspace(getDb(), params.id, actor));

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const { mode } = await body(DraftBriefSchema);
  return reply(202, transact((tx) => requestBriefDraft(tx, params.id, mode, actor)));
});
