/** GET /api/policies/:versionId — everything the policy page shows. */
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { policyDetail } from "@/server/services/policies";

export const GET = api<{ versionId: string }>(({ params }) => policyDetail(getDb(), params.versionId));
