/** PATCH /api/claims/:id — field correction → verified value, new claim version, re-evaluation (reviewer). */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { CorrectClaimSchema, correctClaim } from "@/server/services/claims";

export const PATCH = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(CorrectClaimSchema);
  return transact((tx) => correctClaim(tx, params.id, input, actor));
});
