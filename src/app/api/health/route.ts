/**
 * GET /api/health — the platform's health check (Railway's `healthcheckPath`). The one route anyone
 * may call with no session, so it answers only 200 `{ ok: true }` when the database answers a trivial
 * query, and 503 `{ ok: false }` when it does not. The cause goes to the server log, never the body.
 */
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    const row = getDb().get<{ ok: number }>(sql`select 1 as ok`);
    if (row?.ok !== 1) throw new Error("select 1 did not answer 1");
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[health] the database did not answer:", err instanceof Error ? err.message : err);
    return Response.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
