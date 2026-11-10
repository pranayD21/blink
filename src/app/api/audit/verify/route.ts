/** POST /api/audit/verify — recompute the whole chain; ok, or the first broken sequence number. */
import { verifyAuditChain } from "@/server/audit/log";
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";

export const POST = api(() => verifyAuditChain(getDb()));
