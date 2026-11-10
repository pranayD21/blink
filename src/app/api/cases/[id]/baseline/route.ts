/** POST /api/cases/:id/baseline — the baseline-mode decision; ends the baseline timer (§18.3). */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { BaselineDecisionSchema, recordBaselineDecision } from "@/server/services/sessions";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(BaselineDecisionSchema);
  return transact((tx) => recordBaselineDecision(tx, params.id, input, actor));
});
