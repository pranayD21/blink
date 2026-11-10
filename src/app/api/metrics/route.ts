/** GET /api/metrics — §18.3. */
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { loadMetrics } from "@/server/services/metrics";

export const GET = api(() => loadMetrics(getDb()));
