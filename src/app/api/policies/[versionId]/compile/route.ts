/** POST /api/policies/:versionId/compile — enqueue the compile job (policy owner). */
import { transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { requestCompile } from "@/server/services/policies";

export const POST = api<{ versionId: string }>(({ params, actor }) => reply(202, transact((tx) => requestCompile(tx, params.versionId, actor))));
