/**
 * pnpm smoke --url <base> — checks a running production server from outside, the way a visitor
 * reaches it (Task 42; run against Railway in Task 43, and locally against `scripts/start-prod.sh`).
 *
 * It fails unless: `/api/health` answers 200 `{ ok: true }`; `/` with no session redirects to
 * `/login`; each of the four demo users can sign in with the password under their id in
 * `BLINK_SEED_PASSWORDS`; signed in as the banker, `GET /api/calls` is 403, `POST
 * /api/session/act-as` is 404 and the workspace of a case she does not own is 403 or 404; and
 * signing out ends the session.
 *
 * `BLINK_SEED_PASSWORDS` is read from the environment or `.env.local`. No password or session token
 * is ever printed: each check prints one line with its result and, on a failure, the status seen.
 * It changes nothing but sessions, and signs every user out again at the end.
 */
import { randomBytes } from "node:crypto";
import { DEMO_USERS } from "../src/server/auth/actor";
import { loadEnv } from "../src/server/env";

const COOKIE = "blink_session";
const TIMEOUT_MS = 20_000;

/** The same address the seed gives a demo user: `priya@blink.demo` for Priya Raman. */
const emailOf = (name: string) => `${name.split(" ")[0].toLowerCase()}@blink.demo`;

function baseUrl(argv: string[]): string {
  const i = argv.indexOf("--url");
  const raw = i >= 0 ? argv[i + 1] : argv.find((a) => a.startsWith("--url="))?.slice("--url=".length);
  if (!raw) throw new Error("usage: pnpm smoke --url <base address, like https://blink.up.railway.app>");
  const url = new URL(raw);
  return url.origin;
}

function passwords(): Record<string, string> {
  const raw = process.env.BLINK_SEED_PASSWORDS;
  if (!raw) throw new Error("BLINK_SEED_PASSWORDS is not set (in the environment or .env.local)");
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new Error("BLINK_SEED_PASSWORDS is not valid JSON");
  }
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): boolean {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : ` (${detail})`}`);
  if (!ok) failures++;
  return ok;
}

async function main(): Promise<void> {
  loadEnv();
  const base = baseUrl(process.argv.slice(2));
  const secrets = passwords();
  console.log(`smoke: ${base}`);

  const request = (path: string, init: { method?: string; token?: string | null; body?: unknown } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(init.token ? { cookie: `${COOKIE}=${init.token}` } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  // The health check.
  const health = await request("/api/health");
  const healthBody = await health.text();
  check("GET /api/health is 200 { ok: true }", health.status === 200 && healthBody.replace(/\s/g, "") === '{"ok":true}', `status ${health.status}`);

  // A visitor with no session is sent to sign in.
  const home = await request("/");
  const location = home.headers.get("location");
  const toLogin = location !== null && new URL(location, base).pathname === "/login";
  check("GET / with no session redirects to /login", home.status >= 300 && home.status < 400 && toLogin, `status ${home.status}`);

  // Each demo user signs in.
  const tokens: Record<string, string> = {};
  for (const user of DEMO_USERS) {
    const name = `${user.name} (${user.id}) can sign in`;
    const password = secrets[user.id];
    if (!password) {
      check(name, false, `BLINK_SEED_PASSWORDS has no password for ${user.id}`);
      continue;
    }
    const res = await request("/api/session/login", { method: "POST", body: { email: emailOf(user.name), password } });
    const token = res.headers
      .getSetCookie()
      .map((c) => new RegExp(`^${COOKIE}=([^;]+)`).exec(c)?.[1])
      .find((t) => t);
    const body = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
    if (check(name, res.status === 200 && !!token && body?.user?.id === user.id, `status ${res.status}`)) tokens[user.id] = token!;
  }

  const banker = DEMO_USERS.find((u) => u.role === "analyst")!;
  const reviewer = DEMO_USERS.find((u) => u.role === "reviewer")!;
  const bankerToken = tokens[banker.id];
  if (bankerToken) {
    const calls = await request("/api/calls", { token: bankerToken });
    check("as the banker, GET /api/calls is 403", calls.status === 403, `status ${calls.status}`);

    const actAs = await request("/api/session/act-as", { method: "POST", token: bankerToken, body: { userId: reviewer.id } });
    check("as the banker, POST /api/session/act-as is 404", actAs.status === 404, `status ${actAs.status}`);

    // A case compliance can see and the banker cannot; with none, an id no case has.
    const caseIds = async (token: string | undefined) => {
      if (!token) return [];
      const res = await request("/api/cases", { token });
      const body = (await res.json().catch(() => null)) as { cases?: { id: string }[] } | null;
      return body?.cases?.map((c) => c.id) ?? [];
    };
    const hers = new Set(await caseIds(bankerToken));
    const other = (await caseIds(tokens[reviewer.id])).find((id) => !hers.has(id));
    const caseId = other ?? `case_smoke_${randomBytes(6).toString("hex")}`;
    const workspace = await request(`/api/cases/${encodeURIComponent(caseId)}/workspace`, { token: bankerToken });
    check(`as the banker, the workspace of a case she does not own is 403 or 404 (${other ? "a case only compliance sees" : "no such case exists, so an unknown id"})`, [403, 404].includes(workspace.status), `status ${workspace.status}`);

    const logout = await request("/api/session/logout", { method: "POST", token: bankerToken, body: {} });
    const after = await request("/api/cases", { token: bankerToken });
    check("signing out ends the session", logout.status === 200 && after.status === 401, `sign-out ${logout.status}, then ${after.status}`);
  } else {
    check("the banker's checks", false, "the banker could not sign in");
  }

  // Leave no session behind.
  for (const [id, token] of Object.entries(tokens)) if (id !== banker.id) await request("/api/session/logout", { method: "POST", token, body: {} }).catch(() => null);
}

main()
  .then(() => {
    console.log(failures === 0 ? "smoke: PASS" : `smoke: FAIL (${failures} check${failures === 1 ? "" : "s"})`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err: unknown) => {
    console.error(`smoke: FAIL (${err instanceof Error ? err.message : String(err)})`);
    process.exit(1);
  });
