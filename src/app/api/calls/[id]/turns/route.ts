/** POST /api/calls/:id/turns — one finished turn; replies with the pill decision for it. */
import { api } from "@/server/http/route";
import { TurnSchema, ingestTurn } from "@/server/services/live";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => ingestTurn(params.id, await body(TurnSchema), actor));
