/** Resolves the demo user from the `blink_user` cookie (decision D13). */
import { cookies } from "next/headers";
import { DEFAULT_USER_ID, SESSION_COOKIE } from "@/lib/session";
import { getDb } from "../db/client";
import { unauthorized } from "../errors";
import { type Actor, DEMO_USERS, loadActor } from "./actor";

/** For API routes: the cookie is required. */
export async function requireSessionActor(): Promise<Actor> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) throw unauthorized();
  return loadActor(getDb(), id);
}

/**
 * For pages: a missing or unknown cookie falls back to the default demo user,
 * so the first render after a database reset still works.
 */
export async function pageActor(): Promise<Actor> {
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
