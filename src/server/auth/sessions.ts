/**
 * Server-side sign-in sessions. The browser holds a random token in the `blink_session` cookie; the
 * database holds only its SHA-256, so a copy of the database cannot be used to sign in. A session
 * lasts twelve hours from sign-in and is never extended.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { authSessions, loginAttempts, users } from "../db/schema";
import { nowIso, nowMs } from "../clock";
import { newId } from "../ids";
import type { Actor } from "./actor";

export const SESSION_TTL_HOURS = 12;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const MAX_TOKEN_LENGTH = 128;
/** The longest address RFC 5321 allows. The sign-in route refuses a longer one; this module never stores more. */
export const MAX_EMAIL_LENGTH = 254;

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (email: string): string => email.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);

/** The `blink_session` cookie: out of reach of page scripts, not sent on cross-site posts, HTTPS-only in production, twelve hours. */
export function sessionCookieOptions(maxAgeSeconds = SESSION_TTL_HOURS * 3600) {
  return { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: maxAgeSeconds } as const;
}

export function createSession(tx: DbOrTx, userId: string): { token: string; expiresAt: string } {
  const token = randomBytes(32).toString("base64url");
  const now = nowMs();
  const expiresAt = new Date(now + SESSION_TTL_HOURS * 3_600_000).toISOString();
  const stamp = new Date(now).toISOString();
  tx.insert(authSessions).values({ id: newId("ses"), tokenHash: hashToken(token), userId, createdAt: stamp, expiresAt, lastSeenAt: stamp }).run();
  return { token, expiresAt };
}

/** Who this token belongs to, or null if it is missing, unknown, expired, or its user no longer exists. */
export function sessionActor(db: DbOrTx, token: string | undefined | null): Actor | null {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const tokenHash = hashToken(token);
  const now = nowIso();
  const session = db.select().from(authSessions).where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, now))).get();
  if (!session) return null;
  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;
  db.update(authSessions).set({ lastSeenAt: now }).where(eq(authSessions.id, session.id)).run();
  return { id: user.id, name: user.name, role: user.role };
}

export function destroySession(tx: DbOrTx, token: string): void {
  tx.delete(authSessions).where(eq(authSessions.tokenHash, hashToken(token))).run();
}

/** Five failures for this email in the last fifteen minutes. Successes do not count. */
export function tooManyAttempts(db: DbOrTx, email: string): boolean {
  const since = new Date(nowMs() - ATTEMPT_WINDOW_MS).toISOString();
  const failures = db
    .select({ id: loginAttempts.id })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, normalizeEmail(email)), eq(loginAttempts.ok, false), gt(loginAttempts.at, since)))
    .limit(MAX_FAILURES)
    .all();
  return failures.length >= MAX_FAILURES;
}

/** Removes attempts older than the window and sessions that have expired. Called on each sign-in, so neither table grows without end. */
export function purgeExpired(tx: DbOrTx): void {
  const now = nowMs();
  tx.delete(loginAttempts).where(lte(loginAttempts.at, new Date(now - ATTEMPT_WINDOW_MS).toISOString())).run();
  tx.delete(authSessions).where(lte(authSessions.expiresAt, new Date(now).toISOString())).run();
}

export function recordAttempt(tx: DbOrTx, email: string, ok: boolean): void {
  tx.insert(loginAttempts).values({ id: newId("att"), email: normalizeEmail(email), at: nowIso(), ok }).run();
}
