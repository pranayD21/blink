/** GET /api/cases — list; POST /api/cases — create case + packet + expert (analyst). */
import { getDb, transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { CreateCaseSchema, createCase, listCases } from "@/server/services/cases";

export const GET = api(({ actor }) => ({ cases: listCases(getDb(), actor) }));

export const POST = api(async ({ actor, body }) => {
  const input = await body(CreateCaseSchema);
  return reply(201, transact((tx) => createCase(tx, input, actor)));
});
