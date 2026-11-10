/**
 * POST /api/session/login `{ email, password }` — sign in (live guidance, section 5).
 *
 * 200 `{ user }` and the `blink_session` cookie; 401 `BAD_CREDENTIALS` with one message whether the
 * email is unknown, has no password, or the password is wrong; 429 `TOO_MANY_ATTEMPTS` after five
 * failures for that email in fifteen minutes. An unknown email still costs one scrypt, so the
 * response time does not tell which emails have accounts. Nothing here logs the password or token.
 */
import { eq } from "drizzle-orm";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE } from "@/lib/session";
import { ROLE_LABEL } from "@/server/auth/actor";
import { verifyPassword } from "@/server/auth/password";
import { MAX_EMAIL_LENGTH, createSession, destroySession, normalizeEmail, purgeExpired, recordAttempt, sessionCookieOptions, tooManyAttempts } from "@/server/auth/sessions";
import { getDb, transact } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import { errorResponse, requireSameOrigin } from "@/server/http/route";

const Schema = z.strictObject({
  email: z.string().trim().min(1).max(MAX_EMAIL_LENGTH),
  // scrypt reads the whole password, so a huge one must not reach it.
  password: z.string().min(1).max(1024),
});

/** The hash of a random value that was thrown away. Checked when there is no real hash, so every failure costs the same. */
const DUMMY_HASH = "scrypt$16384$8$1$LXtMHYAcZL4debhJ27LUwA==$8gEHk2y/vgj5SAv0Fhf2M6nPe0N8nulorgebu8aWr56zIlF/96qUhqjmXKsjtzQ0+fSx9AnotqlDnFwc90OLaQ==";

const BAD_CREDENTIALS = new AppError(401, "BAD_CREDENTIALS", "That email and password do not match an account.");
const TOO_MANY = new AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-ins for this email. Try again in 15 minutes.");

export async function POST(req: NextRequest): Promise<Response> {
  try {
    requireSameOrigin(req);
    // A cross-site HTML form cannot send JSON, so this also stops another site from signing a visitor in.
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "send the sign-in as JSON");
    }
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw badRequest("the request body is not valid JSON");
    }
    const { password, ...rest } = Schema.parse(raw);
    const email = normalizeEmail(rest.email);
    const db = getDb();

    transact((tx) => purgeExpired(tx));
    if (tooManyAttempts(db, email)) throw TOO_MANY;

    const user = db.select().from(users).where(eq(users.email, email)).get();
    const matches = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    const ok = matches && !!user?.passwordHash;

    const earlier = req.cookies.get(AUTH_COOKIE)?.value;
    const session = transact((tx) => {
      recordAttempt(tx, email, ok);
      if (!ok || !user) return null;
      // One browser holds one session: signing in again ends the one it had.
      if (earlier) destroySession(tx, earlier);
      return createSession(tx, user.id);
    });
    if (!session || !user) throw BAD_CREDENTIALS;

    const res = NextResponse.json({ user: { id: user.id, name: user.name, role: user.role, roleLabel: ROLE_LABEL[user.role] } });
    res.cookies.set(AUTH_COOKIE, session.token, sessionCookieOptions());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
