/** GET /api/calls/:id — one call's record, moment by moment. Compliance reviewers only; anyone else gets 403. */
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { callTrace } from "@/server/services/observability";

export const GET = api<{ id: string }>(({ params, actor }) => callTrace(getDb(), params.id, actor));
