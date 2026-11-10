/** Job `reevaluate_case` (§9.1): re-run comparison and the monitors for a case, with no model call. */
import { fromJson, transact } from "../../db/client";
import { reevaluateCase, runComparison } from "../../services/evaluation";
import { isEvaluable, loadCurrentClaims } from "../../services/loaders";
import type { JobRow } from "../queue";

export async function reevaluateCaseJob(job: JobRow): Promise<Record<string, unknown>> {
  const { caseId, reason } = fromJson<{ caseId: string; reason?: string }>(job.payloadJson, { caseId: "" });
  const result = transact((tx) => {
    for (const claim of loadCurrentClaims(tx, caseId).filter(isEvaluable)) runComparison(tx, caseId, claim);
    return reevaluateCase(tx, caseId, { actorId: "system", reason: reason ?? "re-evaluation requested", eventType: "CONTEXT_UPDATED", eventToken: `job:${job.id}` });
  });
  return { caseId, claimsEvaluated: result.claimsEvaluated, findingsOpened: result.findingsOpened, stale: result.stale.map((s) => s.label) };
}
