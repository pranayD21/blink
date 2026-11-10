/**
 * Gives a first-time visitor a demo user (decision D13: no login, but every
 * request still names an actor whose role the server checks).
 */
import { type NextRequest, NextResponse } from "next/server";
import { DEFAULT_USER_ID, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  // Set it on the request too, so this very render already sees the user.
  request.cookies.set(SESSION_COOKIE, DEFAULT_USER_ID);
  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SESSION_COOKIE, DEFAULT_USER_ID, { path: "/", sameSite: "lax", maxAge: SESSION_MAX_AGE_SECONDS });
  return response;
}

export const config = {
  // Pages only: API calls must already carry the cookie, and static assets need no user.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
