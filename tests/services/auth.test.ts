/**
 * Accounts and sessions (live guidance, section 5): a password is stored as a salted scrypt hash, a sign-in
 * is a random token of which only the SHA-256 is kept, and five failures lock an email out for a while.
 * No assertion message here prints a password or a token.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { SESSION_TTL_HOURS, createSession, destroySession, recordAttempt, sessionActor, tooManyAttempts } from "@/server/auth/sessions";
import { setClockForTests } from "@/server/clock";
import { getDb, resetDbForTests } from "@/server/db/client";
import { authSessions, loginAttempts, users } from "@/server/db/schema";
import { seedBase } from "@/server/services/seed";

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

  it("fails without echoing the value when BLINK_SEED_PASSWORDS is not a JSON object of strings", () => {
    for (const bad of ["not json with secret-value", '["secret-value"]', '{"user_priya": 5}']) {
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
