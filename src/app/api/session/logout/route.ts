/**
 * POST /api/session/logout — end this browser's session and clear its cookie. 200 whether signed in
 * or not. Like sign-in it must be sent as JSON, so a cross-site HTML form cannot sign a visitor out.
 */
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/session";
import { destroySession, sessionCookieOptions } from "@/server/auth/sessions";
import { transact } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http/route";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "send the sign-out as JSON");
    }
    const token = req.cookies.get(AUTH_COOKIE)?.value;
    if (token) transact((tx) => destroySession(tx, token));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE, "", sessionCookieOptions(0));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
