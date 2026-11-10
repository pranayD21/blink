/**
 * POST /api/session/register `{ name, email, password }` — open a banker account and sign in.
 *
 * The role is always banker. 200 `{ user }` and the session cookie. 409 `EMAIL_TAKEN` when the
 * email is already an account. 429 after five failed sign-ins for that email in fifteen minutes.
 * The password is never logged or returned.
 */
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AUTH_COOKIE } from "@/lib/session";
import { createAccount } from "@/server/auth/accounts";
import { ROLE_LABEL } from "@/server/auth/actor";
import { MAX_EMAIL_LENGTH, createSession, destroySession, normalizeEmail, purgeExpired, recordAttempt, sessionCookieOptions, tooManyAttempts } from "@/server/auth/sessions";
import { getDb, transact } from "@/server/db/client";
import { AppError, badRequest } from "@/server/errors";
import { errorResponse, requireSameOrigin } from "@/server/http/route";

const Schema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().min(3).max(MAX_EMAIL_LENGTH).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "enter a valid email address"),
  password: z.string().min(8, "use at least 8 characters").max(1024),
});

const TOO_MANY = new AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed sign-ins for this email. Try again in 15 minutes.");

export async function POST(req: NextRequest): Promise<Response> {
  try {
    requireSameOrigin(req);
    if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "send the account as JSON");
    }
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw badRequest("the request body is not valid JSON");
    }
    const parsed = Schema.parse(raw);
    const email = normalizeEmail(parsed.email);
    const db = getDb();

    transact((tx) => purgeExpired(tx));
    if (tooManyAttempts(db, email)) throw TOO_MANY;

    const earlier = req.cookies.get(AUTH_COOKIE)?.value;
    const created = transact((tx) => {
      const account = createAccount(tx, parsed);
      recordAttempt(tx, email, true);
      if (earlier) destroySession(tx, earlier);
      return { account, session: createSession(tx, account.id) };
    });

    const res = NextResponse.json({
      user: { id: created.account.id, name: created.account.name, role: created.account.role, roleLabel: ROLE_LABEL[created.account.role] },
    });
    res.cookies.set(AUTH_COOKIE, created.session.token, sessionCookieOptions());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
