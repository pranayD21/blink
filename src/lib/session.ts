/**
 * Session constants. Kept free of server imports so the proxy can use
 * them without pulling in the database.
 */
export const SESSION_COOKIE = "blink_user";

/** The cookie that carries a real sign-in: a random token, never a user id. */
export const AUTH_COOKIE = "blink_session";

/** New visitors start as the compliance reviewer, the role most of the app is for. */
export const DEFAULT_USER_ID = "user_marcus";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** The proxy passes the page's own path and query to the server render in this header, for `/login?next=`. */
export const PATH_HEADER = "x-blink-path";

export const LOGIN_PATH = "/login";

/**
 * Where to go after signing in: a path on this site, or the home page. Anything that a browser could
 * read as another host (`//host`, `/\host`, a full URL) is refused, and so is the sign-in page itself.
 */
export function safeNextPath(next: string | string[] | undefined | null): string {
  if (typeof next !== "string" || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  if (next === LOGIN_PATH || next.startsWith(`${LOGIN_PATH}?`) || next.startsWith(`${LOGIN_PATH}/`)) return "/";
  return next;
}
