/** POST /api/session/logout — end this browser's session and clear its cookie. Always 200, signed in or not. */
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/session";
import { destroySession, sessionCookieOptions } from "@/server/auth/sessions";
import { transact } from "@/server/db/client";
import { errorResponse } from "@/server/http/route";

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const token = req.cookies.get(AUTH_COOKIE)?.value;
    if (token) transact((tx) => destroySession(tx, token));
    const res = NextResponse.json({ ok: true });
    res.cookies.set(AUTH_COOKIE, "", sessionCookieOptions(0));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
