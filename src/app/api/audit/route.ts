/** GET /api/audit?caseId= — audit events (reviewer; the policy owner may read events not tied to a case). */
import { requireReviewer, requireRole } from "@/server/auth/actor";
import { listAudit } from "@/server/audit/log";
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";

export const GET = api(({ req, actor }) => {
  const caseId = req.nextUrl.searchParams.get("caseId");
  if (caseId) {
    requireReviewer(actor);
    return { events: listAudit(getDb(), caseId) };
  }
  requireRole(actor, "reviewer", "senior_reviewer", "policy_owner");
  const events = listAudit(getDb());
  // Case events can name findings; the policy owner sees only what is not tied to a case.
  return { events: actor.role === "policy_owner" ? events.filter((e) => e.caseId === null) : events };
});
