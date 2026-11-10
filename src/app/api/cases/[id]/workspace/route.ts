/** GET /api/cases/:id/workspace — everything for the review screen in one payload (reviewer). */
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { loadWorkspace } from "@/server/services/workspace";

export const GET = api<{ id: string }>(({ params, actor }) => loadWorkspace(getDb(), params.id, actor));
