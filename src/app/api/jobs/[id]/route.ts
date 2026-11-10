/** GET /api/jobs/:id — job status and stage. The UI polls this every second. */
import { requireCaseAccess } from "@/server/auth/access";
import { isReviewer } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { AppError, notFound } from "@/server/errors";
import { api } from "@/server/http/route";
import { getJob, toJobView } from "@/server/jobs/queue";

export const GET = api<{ id: string }>(({ params, actor }) => {
  const db = getDb();
  const row = getJob(db, params.id);
  if (!row) throw notFound("job");
  const view = toJobView(row);
  // A job of a case is the case's: another banker's is not there at all, and the policy owner is refused.
  // A job with no case (compiling a policy, reading a document) keeps the role rule below.
  const caseId = view.payload.caseId;
  if (typeof caseId === "string") {
    try {
      requireCaseAccess(db, actor, caseId);
    } catch (err) {
      if (err instanceof AppError && err.status === 404) throw notFound("job");
      throw err;
    }
  }
  // A job's result can mention findings; only reviewers and the policy owner (compile jobs) see it.
  const mayReadResult = isReviewer(actor) || (actor.role === "policy_owner" && view.type === "compile_policy");
  return { job: mayReadResult ? view : { ...view, payload: {}, result: null } };
});
