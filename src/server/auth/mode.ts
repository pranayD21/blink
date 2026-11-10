/**
 * Which kind of sign-in this server uses (live guidance, section 5). The role switcher lets anyone
 * become a reviewer, so it is only used when asked for by name, and in a production build only with
 * an explicit allowance as well (the demo and the e2e servers run `next start`). Everything else
 * signs in with a password. Reads only the environment, so the proxy can import it.
 */
export type AuthMode = "password" | "switcher";

export function authMode(): AuthMode {
  if (process.env.BLINK_AUTH_MODE !== "switcher") return "password";
  if (process.env.NODE_ENV === "production" && process.env.BLINK_ALLOW_SWITCHER !== "1") return "password";
  return "switcher";
}
