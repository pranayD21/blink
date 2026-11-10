/** GET /api/metrics — §18.3. Reviewers get everything, the policy owner the per-stage costs, a banker 403. */
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { metricsFor } from "@/server/services/metrics";

export const GET = api(({ actor }) => metricsFor(getDb(), actor));
