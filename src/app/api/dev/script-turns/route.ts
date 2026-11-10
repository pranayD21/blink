/**
 * GET /api/dev/script-turns — the scripted Halvorsen call, for `/desktop?source=script`. Development
 * and tests only: without BLINK_ALLOW_SCRIPTED_CALLS=1 the route is not there at all.
 */
import type { NextRequest } from "next/server";
import { requireRole } from "@/server/auth/actor";
import { notFound } from "@/server/errors";
import { api, errorResponse } from "@/server/http/route";
import { scriptedCallsAllowed } from "@/server/services/live";
import { halvorsenLiveTurns } from "@/server/services/seed";

const handler = api(({ actor }) => {
  requireRole(actor, "analyst");
  return { turns: halvorsenLiveTurns().map(({ speaker, text }) => ({ speaker, text })) };
});

export function GET(req: NextRequest, context: { params: Promise<Record<string, never>> }): Promise<Response> {
  // Checked before anything else, so a deployed Blink answers 404 whoever asks.
  if (!scriptedCallsAllowed()) return Promise.resolve(errorResponse(notFound("route")));
  return handler(req, context);
}
