/**
 * Demo session constants. Kept free of server imports so the proxy can use
 * them without pulling in the database.
 */
export const SESSION_COOKIE = "blink_user";

/** The cookie that carries a real sign-in: a random token, never a user id. */
export const AUTH_COOKIE = "blink_session";

/** New visitors start as the compliance reviewer, the role most of the app is for. */
export const DEFAULT_USER_ID = "user_marcus";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
