/** POST /api/findings — a reviewer raises a finding the policy and the model did not. */
import { transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { CreateFindingSchema, createReviewerFinding } from "@/server/services/findings";
import { findingLabel } from "@/server/services/findingsCore";

export const POST = api(async ({ actor, body }) => {
  const input = await body(CreateFindingSchema);
  const finding = transact((tx) => createReviewerFinding(tx, input, actor));
  return reply(201, { findingId: finding.id, label: findingLabel(finding), state: finding.state, version: finding.version });
});
