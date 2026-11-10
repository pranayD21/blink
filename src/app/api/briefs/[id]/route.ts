/** PATCH /api/briefs/:id — edit the text; this creates a new version with a new hash (reviewer). */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { EditBriefSchema, editBrief } from "@/server/services/briefs";

export const PATCH = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(EditBriefSchema);
  const brief = transact((tx) => editBrief(tx, params.id, input, actor));
  return { briefId: brief.id, versionNo: brief.versionNo, contentHash: brief.contentHash, version: brief.version };
});
