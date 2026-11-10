/** GET /api/jobs/:id — job status and stage. The UI polls this every second. */
import { isReviewer } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { notFound } from "@/server/errors";
import { api } from "@/server/http/route";
import { getJob, toJobView } from "@/server/jobs/queue";

export const GET = api<{ id: string }>(({ params, actor }) => {
  const row = getJob(getDb(), params.id);
  if (!row) throw notFound("job");
  const view = toJobView(row);
  // A job's result can mention findings; only reviewers and the policy owner (compile jobs) see it.
  const mayReadResult = isReviewer(actor) || (actor.role === "policy_owner" && view.type === "compile_policy");
  return { job: mayReadResult ? view : { ...view, payload: {}, result: null } };
});
