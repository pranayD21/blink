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

const LOCAL_ORIGIN = "http://local.invalid";

/**
 * Where to go after signing in: a path on this site, or the home page. `next` is resolved the way a
 * browser would resolve it, against a dummy origin, and refused unless it stays on that origin, so
 * `//host`, `/\\host`, a full URL, or one hidden behind a tab or newline (which URL parsing strips)
 * cannot leave the site. Control characters are refused outright, and so is the sign-in page itself.
 */
export function safeNextPath(next: string | string[] | undefined | null): string {
  if (typeof next !== "string" || !next.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  let url: URL;
  try {
    url = new URL(next, LOCAL_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== LOCAL_ORIGIN) return "/";
  if (url.pathname === LOGIN_PATH || url.pathname.startsWith(`${LOGIN_PATH}/`)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
