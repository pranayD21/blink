/** POST /api/findings/:id/events — PROMOTE, ESCALATE, or DISPOSE (reviewer, senior reviewer). */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { FindingEventSchema, applyFindingAction } from "@/server/services/findings";
import { findingLabel } from "@/server/services/findingsCore";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(FindingEventSchema);
  const { finding, decisionId } = transact((tx) => applyFindingAction(tx, params.id, input, actor));
  return { findingId: finding.id, label: findingLabel(finding), state: finding.state, version: finding.version, decisionId };
});
