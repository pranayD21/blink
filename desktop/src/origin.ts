/** The one origin the shell talks to, and the rule that keeps every window on it. Pure, so the root test suite can cover it. */

export type Server = { url: string; origin: string };

/** Parses `--server=` or `BLINK_URL`. Throws an Error with a one-line reason when it is not an http(s) URL. */
export function parseServer(raw: string | undefined): Server {
  const text = (raw && raw.trim()) || "http://localhost:3000";
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`"${text}" is not a URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`"${text}" must start with http:// or https://`);
  }
  return { url: text.replace(/\/+$/, ""), origin: parsed.origin };
}

/** True when a URL belongs to the given origin. Anything unparseable, and any opaque origin, is outside it. */
export function inOrigin(origin: string, url: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
