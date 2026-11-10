/**
 * Runs before every page (live guidance, section 5).
 *
 * Password mode: a page request with no `blink_session` cookie goes to `/login?next=<path>`. This is
 * only the optimistic check: `pageActor()` on the page does the real one and redirects the same way
 * for a cookie that is stale or forged.
 *
 * Switcher mode: gives a first-time visitor a demo user (decision D13: no login, but every request
 * still names an actor whose role the server checks).
 *
 * Both pass the page's path to the render in a request header, so `pageActor()` can send the
 * visitor back to it after signing in.
 */
import { type NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE, DEFAULT_USER_ID, LOGIN_PATH, PATH_HEADER, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";
import { authMode } from "@/server/auth/mode";

/** Pages that must open with nobody signed in: the sign-in page, and the pill window, which shows only what it is sent. */
const isPublic = (path: string) => path === LOGIN_PATH || path === "/desktop/pill" || path === "/";

/** Continue to the page, with its path in a request header. Copied after any cookie change so that change is kept. */
function next(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers } });
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (authMode() === "password") {
    if (isPublic(pathname) || request.cookies.get(AUTH_COOKIE)?.value) return next(request);
    const login = new URL(LOGIN_PATH, request.url);
    if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  if (request.cookies.has(SESSION_COOKIE)) return next(request);
  // Set it on the request too, so this very render already sees the user.
  request.cookies.set(SESSION_COOKIE, DEFAULT_USER_ID);
  const response = next(request);
  response.cookies.set(SESSION_COOKIE, DEFAULT_USER_ID, { path: "/", sameSite: "lax", maxAge: SESSION_MAX_AGE_SECONDS });
  return response;
}

export const config = {
  // Pages only: API calls must already carry the cookie, and static assets need no user.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|svg|jpg|ico)$).*)"],
};
