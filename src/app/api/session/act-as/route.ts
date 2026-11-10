/**
 * POST /api/session/act-as — switch demo user (sets the cookie). Any visitor may call it, so it
 * exists only in switcher mode; with password sign-in it is a 404, as if it were not there.
 */
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { ROLE_LABEL, loadActor } from "@/server/auth/actor";
import { authMode } from "@/server/auth/mode";
import { getDb } from "@/server/db/client";
import { AppError, badRequest } from "@/server/errors";
import { errorResponse } from "@/server/http/route";

const Schema = z.strictObject({ userId: z.string().min(1) });

export async function POST(req: NextRequest): Promise<Response> {
  try {
    if (authMode() !== "switcher") throw new AppError(404, "NOT_FOUND", "not found");
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw badRequest("the request body is not valid JSON");
    }
    const { userId } = Schema.parse(raw);
    const actor = loadActor(getDb(), userId);
    (await cookies()).set(SESSION_COOKIE, actor.id, { path: "/", sameSite: "lax", maxAge: SESSION_MAX_AGE_SECONDS });
    return Response.json({ user: { ...actor, roleLabel: ROLE_LABEL[actor.role] } });
  } catch (err) {
    return errorResponse(err);
  }
}
