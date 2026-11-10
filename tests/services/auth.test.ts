/**
 * Accounts and sessions (live guidance, section 5): a password is stored as a salted scrypt hash, a sign-in
 * is a random token of which only the SHA-256 is kept, and five failures lock an email out for a while.
 * No assertion message here prints a password or a token.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeNextPath } from "@/lib/session";
import { authMode } from "@/server/auth/mode";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { SESSION_TTL_HOURS, createSession, destroySession, purgeExpired, recordAttempt, sessionActor, tooManyAttempts } from "@/server/auth/sessions";
import { setClockForTests } from "@/server/clock";
import { getDb, resetDbForTests } from "@/server/db/client";
import { authSessions, auditEvents, cases, documents, jobs, loginAttempts, users } from "@/server/db/schema";
import { seedBase, seedUsersOnly } from "@/server/services/seed";

const START = Date.parse("2026-11-10T09:00:00.000Z");
let now = START;
const advance = (ms: number) => {
  now += ms;
};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

beforeEach(() => {
  now = START;
  setClockForTests(() => new Date(now));
  resetDbForTests();
  delete process.env.BLINK_SEED_PASSWORDS;
  seedBase({ enqueueDocFacts: false, goldDocFacts: true });
});
afterEach(() => {
  setClockForTests(null);
  delete process.env.BLINK_SEED_PASSWORDS;
  vi.unstubAllEnvs();
});

const sessionRows = () => getDb().select().from(authSessions).all();

describe("passwords", () => {
  it("a password verifies only against its own hash, and the hash is not the password", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    expect(h).not.toContain("correct horse");
    expect(verifyPassword("x", null)).toBe(false);
  });

  it("uses the stated format, a fresh 16-byte salt each time, and a 64-byte key", () => {
    const a = hashPassword("same");
    const b = hashPassword("same");
    expect(a).not.toBe(b);
    const [scheme, n, r, p, salt, key] = a.split("$");
    expect([scheme, n, r, p]).toEqual(["scrypt", "16384", "8", "1"]);
    expect(Buffer.from(salt, "base64")).toHaveLength(16);
    expect(Buffer.from(key, "base64")).toHaveLength(64);
  });

  it("refuses a malformed or foreign stored value instead of throwing", () => {
    for (const stored of ["", "plain", "scrypt$1$2", "bcrypt$16384$8$1$AAAA$AAAA", "scrypt$16384$8$1$AAAA$AAAA"]) expect(verifyPassword("x", stored)).toBe(false);
  });
});

describe("sessions", () => {
  it("a session resolves to its user until it expires", () => {
    const { token, expiresAt } = createSession(getDb(), "user_priya");
    expect(Date.parse(expiresAt)).toBe(START + SESSION_TTL_HOURS * HOUR);
    expect(sessionActor(getDb(), token)?.id).toBe("user_priya");
    expect(sessionActor(getDb(), token)?.role).toBe("analyst");
    advance(SESSION_TTL_HOURS * HOUR + MINUTE);
    expect(sessionActor(getDb(), token)).toBeNull();
  });

  it("the stored value is not the token, and only its SHA-256 is stored", () => {
    const { token } = createSession(getDb(), "user_marcus");
    const [row] = sessionRows();
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("tokens are unique per sign-in", () => {
    expect(createSession(getDb(), "user_priya").token).not.toBe(createSession(getDb(), "user_priya").token);
  });

  it("a missing, empty, unknown or guessed token resolves to nobody", () => {
    createSession(getDb(), "user_priya");
    for (const t of [undefined, null, "", "not-a-token", "A".repeat(43)]) expect(sessionActor(getDb(), t)).toBeNull();
  });

  it("destroying a session ends it", () => {
    const { token } = createSession(getDb(), "user_jordan");
    destroySession(getDb(), token);
    expect(sessionActor(getDb(), token)).toBeNull();
    expect(sessionRows()).toHaveLength(0);
  });

  it("a session whose user is gone resolves to nobody", () => {
    const { token } = createSession(getDb(), "user_dana");
    getDb().delete(users).where(eq(users.id, "user_dana")).run();
    expect(sessionActor(getDb(), token)).toBeNull();
  });

  it("records when it was last used, without extending its expiry", () => {
    const { token, expiresAt } = createSession(getDb(), "user_priya");
    advance(HOUR);
    sessionActor(getDb(), token);
    const [row] = sessionRows();
    expect(Date.parse(row.lastSeenAt)).toBe(START + HOUR);
    expect(row.expiresAt).toBe(expiresAt);
  });
});

describe("sign-in attempts", () => {
  it("the sixth attempt after five failures is refused, and the window is fifteen minutes", () => {
    const email = "priya@blink.demo";
    for (let i = 0; i < 4; i++) recordAttempt(getDb(), email, false);
    expect(tooManyAttempts(getDb(), email)).toBe(false);
    recordAttempt(getDb(), email, false);
    expect(tooManyAttempts(getDb(), email)).toBe(true);
    advance(14 * MINUTE);
    expect(tooManyAttempts(getDb(), email)).toBe(true);
    advance(2 * MINUTE);
    expect(tooManyAttempts(getDb(), email)).toBe(false);
  });

  it("counts only failures, and only for that email", () => {
    for (let i = 0; i < 5; i++) recordAttempt(getDb(), "marcus@blink.demo", true);
    for (let i = 0; i < 5; i++) recordAttempt(getDb(), "jordan@blink.demo", false);
    expect(tooManyAttempts(getDb(), "marcus@blink.demo")).toBe(false);
    expect(tooManyAttempts(getDb(), "dana@blink.demo")).toBe(false);
    expect(tooManyAttempts(getDb(), "jordan@blink.demo")).toBe(true);
  });

  it("treats the email case-insensitively", () => {
    for (let i = 0; i < 5; i++) recordAttempt(getDb(), "Priya@Blink.Demo", false);
    expect(tooManyAttempts(getDb(), "priya@blink.demo")).toBe(true);
    expect(getDb().select().from(loginAttempts).all()[0].email).toBe("priya@blink.demo");
  });
});

describe("old records are purged", () => {
  it("drops attempts older than the window and sessions that have expired, and keeps the rest", () => {
    recordAttempt(getDb(), "old@blink.demo", false);
    const expired = createSession(getDb(), "user_priya");
    advance(SESSION_TTL_HOURS * HOUR + MINUTE);
    recordAttempt(getDb(), "new@blink.demo", false);
    const live = createSession(getDb(), "user_marcus");
    purgeExpired(getDb());
    expect(getDb().select().from(loginAttempts).all().map((a) => a.email)).toEqual(["new@blink.demo"]);
    expect(sessionActor(getDb(), expired.token)).toBeNull();
    expect(sessionActor(getDb(), live.token)?.id).toBe("user_marcus");
    expect(sessionRows()).toHaveLength(1);
  });
});

describe("auth mode", () => {
  const mode = (env: Record<string, string>) => {
    vi.stubEnv("BLINK_AUTH_MODE", "");
    vi.stubEnv("BLINK_ALLOW_SWITCHER", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return authMode();
  };

  it("in production the switcher needs an explicit allowance", () => {
    expect(mode({ NODE_ENV: "production", BLINK_AUTH_MODE: "switcher" })).toBe("password");
    expect(mode({ NODE_ENV: "production", BLINK_AUTH_MODE: "switcher", BLINK_ALLOW_SWITCHER: "1" })).toBe("switcher");
    expect(mode({ NODE_ENV: "production", BLINK_AUTH_MODE: "switcher", BLINK_ALLOW_SWITCHER: "true" })).toBe("password");
  });

  it("outside production the switcher is used only when asked for", () => {
    expect(mode({ NODE_ENV: "development", BLINK_AUTH_MODE: "switcher" })).toBe("switcher");
    expect(mode({ NODE_ENV: "test", BLINK_AUTH_MODE: "switcher" })).toBe("switcher");
    expect(mode({ NODE_ENV: "development" })).toBe("password");
    expect(mode({ NODE_ENV: "development", BLINK_AUTH_MODE: "Switcher" })).toBe("password");
    expect(mode({ NODE_ENV: "development", BLINK_ALLOW_SWITCHER: "1" })).toBe("password");
  });
});

describe("where sign-in may send you next", () => {
  it("keeps a path on this site and turns anything else into the home page", () => {
    expect(safeNextPath("/desktop")).toBe("/desktop");
    expect(safeNextPath("/cases/case_1?tab=brief")).toBe("/cases/case_1?tab=brief");
    for (const bad of [undefined, null, "", "desktop", "//evil.example", "/\\evil.example", "https://evil.example/", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", decodeURIComponent("/%09/evil.example"), "/./..//evil.example", "/..//evil.example", "/.//evil.example", "/a/../..//evil.example", "/a\u0000b", "/a\u007fb", "/login", "/login?next=/x", ["/a", "/b"]]) {
      expect(safeNextPath(bad as string | undefined)).toBe("/");
    }
  });
});

describe("every page checks the session itself", () => {
  // The proxy only sees that a cookie exists; pageActor() is what refuses a stale or forged one.
  const PUBLIC = new Set(["login/page.tsx", "desktop/pill/page.tsx"]);
  const pages = readdirSync("src/app", { recursive: true, encoding: "utf8" })
    .map((f) => f.split("\\").join("/"))
    .filter((f) => f === "page.tsx" || f.endsWith("/page.tsx"))
    .sort();

  it("finds the pages, including the public ones", () => {
    expect(pages.length).toBeGreaterThan(10);
    for (const p of PUBLIC) expect(pages).toContain(p);
  });

  it("each page except /login and /desktop/pill calls pageActor", () => {
    // Comments are removed first, so a page cannot pass by mentioning the call without making it.
    const code = (p: string) => readFileSync(join("src/app", p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    const missing = pages.filter((p) => !PUBLIC.has(p) && !/\bawait\s+pageActor\(\)/.test(code(p)));
    expect(missing).toEqual([]);
  });
});

describe("seeding accounts", () => {
  const rows = () => Object.fromEntries(getDb().select().from(users).all().map((u) => [u.id, u]));

  it("gives each demo user an email and no password when none is configured", () => {
    const r = rows();
    expect(r.user_priya.email).toBe("priya@blink.demo");
    expect(r.user_marcus.email).toBe("marcus@blink.demo");
    expect(r.user_jordan.email).toBe("jordan@blink.demo");
    expect(r.user_dana.email).toBe("dana@blink.demo");
    for (const u of Object.values(r)) expect(u.passwordHash).toBeNull();
  });

  it("hashes the passwords named in BLINK_SEED_PASSWORDS and leaves the rest null, on a re-seed too", () => {
    process.env.BLINK_SEED_PASSWORDS = JSON.stringify({ user_priya: "pw-for-priya", user_dana: "pw-for-dana" });
    seedBase({ enqueueDocFacts: false, goldDocFacts: true });
    const r = rows();
    expect(verifyPassword("pw-for-priya", r.user_priya.passwordHash)).toBe(true);
    expect(verifyPassword("pw-for-dana", r.user_dana.passwordHash)).toBe(true);
    expect(verifyPassword("pw-for-dana", r.user_priya.passwordHash)).toBe(false);
    expect(r.user_marcus.passwordHash).toBeNull();
    expect(r.user_jordan.passwordHash).toBeNull();
    expect(r.user_priya.passwordHash).not.toContain("pw-for-priya");
  });

  it("does not overwrite a password that is already set", () => {
    process.env.BLINK_SEED_PASSWORDS = JSON.stringify({ user_priya: "first" });
    seedBase({ enqueueDocFacts: false, goldDocFacts: true });
    const before = rows().user_priya.passwordHash;
    process.env.BLINK_SEED_PASSWORDS = JSON.stringify({ user_priya: "second" });
    seedBase({ enqueueDocFacts: false, goldDocFacts: true });
    expect(rows().user_priya.passwordHash).toBe(before);
  });

  it("with --users-only, inserts the users on an empty database and touches nothing else", () => {
    resetDbForTests();
    process.env.BLINK_SEED_PASSWORDS = JSON.stringify({ user_priya: "pw-for-priya" });
    expect(seedUsersOnly()).toEqual({ inserted: 4, updated: 0 });
    const r = rows();
    expect(Object.keys(r).sort()).toEqual(["user_dana", "user_jordan", "user_marcus", "user_priya"]);
    expect(verifyPassword("pw-for-priya", r.user_priya.passwordHash)).toBe(true);
    expect(r.user_marcus.passwordHash).toBeNull();
    const db = getDb();
    for (const table of [cases, documents, jobs, auditEvents]) expect(db.select().from(table).all()).toEqual([]);
  });

  it("with --users-only, fills in a missing password on a seeded database and keeps one that is set", () => {
    process.env.BLINK_SEED_PASSWORDS = JSON.stringify({ user_priya: "first" });
    seedBase({ enqueueDocFacts: false, goldDocFacts: true });
    const before = rows().user_priya.passwordHash;
    const audit = getDb().select().from(auditEvents).all().length;
    process.env.BLINK_SEED_PASSWORDS = JSON.stringify({ user_priya: "second", user_marcus: "pw-for-marcus" });
    expect(seedUsersOnly()).toEqual({ inserted: 0, updated: 1 });
    const r = rows();
    expect(r.user_priya.passwordHash).toBe(before);
    expect(verifyPassword("pw-for-marcus", r.user_marcus.passwordHash)).toBe(true);
    expect(getDb().select().from(auditEvents).all()).toHaveLength(audit);
  });

  it("fails without echoing the value when BLINK_SEED_PASSWORDS is not a JSON object of strings", () => {
    for (const bad of ["not json with secret-value", '["secret-value"]', '{"user_priya": 5}', '{"secret-value": "x"}', '{"user_priya": "secret-value", "user_mallory": "secret-value"}']) {
      process.env.BLINK_SEED_PASSWORDS = bad;
      let message = "";
      try {
        seedBase({ enqueueDocFacts: false, goldDocFacts: true });
      } catch (e) {
        message = String((e as Error).message);
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("secret-value");
    }
  });
});
