/**
 * Who is making this request. In `switcher` mode (development, tests, the demo) the `blink_user`
 * cookie names a demo user (decision D13). In `password` mode only a signed-in session counts: the
 * `blink_session` cookie carries a random token, and `blink_user` is ignored.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_COOKIE, DEFAULT_USER_ID, LOGIN_PATH, PATH_HEADER, SESSION_COOKIE, safeNextPath } from "@/lib/session";
import { getDb } from "../db/client";
import { unauthorized } from "../errors";
import { type Actor, DEMO_USERS, loadActor } from "./actor";
import { authMode } from "./mode";
import { sessionActor } from "./sessions";

const signedInActor = async (): Promise<Actor | null> => sessionActor(getDb(), (await cookies()).get(AUTH_COOKIE)?.value);

/** For API routes: a session is required. */
export async function requireSessionActor(): Promise<Actor> {
  if (authMode() === "password") {
    const actor = await signedInActor();
    if (!actor) throw unauthorized("sign in first");
    return actor;
  }
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) throw unauthorized();
  return loadActor(getDb(), id);
}

/**
 * In switcher mode a missing or unknown cookie falls back to the default demo user, so the first
 * render after a database reset still works.
 */
async function switcherActor(): Promise<Actor> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value ?? DEFAULT_USER_ID;
  try {
    return loadActor(getDb(), id);
  } catch {
    try {
      return loadActor(getDb(), DEFAULT_USER_ID);
    } catch {
      // The database has not been seeded yet; pages show a hint instead of crashing.
      return DEMO_USERS.find((u) => u.id === DEFAULT_USER_ID)!;
    }
  }
}

/** For pages. In password mode a request with no valid session is sent to sign in, and back here afterwards. */
export async function pageActor(): Promise<Actor> {
  if (authMode() === "switcher") return switcherActor();
  const actor = await signedInActor();
  if (actor) return actor;
  const here = safeNextPath((await headers()).get(PATH_HEADER));
  redirect(here === "/" ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(here)}`);
}

/** For the header and the sign-in page: who is signed in, or null. Never redirects, so those pages cannot loop. */
export async function optionalPageActor(): Promise<Actor | null> {
  if (authMode() === "switcher") return switcherActor();
  return signedInActor();
}
