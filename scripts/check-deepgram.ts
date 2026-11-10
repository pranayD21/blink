/**
 * pnpm exec tsx scripts/check-deepgram.ts — checks that DEEPGRAM_API_KEY can
 * mint short-lived tokens (POST /v1/auth/grant, which needs the Member role).
 * Prints `grant: <status>` and nothing else; exits 0 only on a 200 whose body
 * has an `access_token`. The key and the token are never printed.
 */
import { loadEnv } from "../src/server/env";

async function main(): Promise<boolean> {
  loadEnv();
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    console.log("grant: no key");
    return false;
  }
  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: 30 }),
    });
    console.log(`grant: ${res.status}`);
    if (res.status !== 200) return false;
    const body = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
    return typeof body?.access_token === "string" && body.access_token.length > 0;
  } catch {
    console.log("grant: unreachable");
    return false;
  }
}

main().then((ok) => process.exit(ok ? 0 : 1));
