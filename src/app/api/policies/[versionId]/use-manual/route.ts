/** POST /api/policies/:versionId/use-manual — load the labeled hand-written fallback monitors (§8.9). */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { loadManualFallback } from "@/server/services/policies";

export const POST = api<{ versionId: string }>(({ params, actor }) => transact((tx) => loadManualFallback(tx, params.versionId, actor)));
