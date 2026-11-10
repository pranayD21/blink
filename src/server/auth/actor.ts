/**
 * Demo auth (decision D13): a cookie names one of the seeded users. There is
 * no login, but authority checks are real — every mutation resolves the actor
 * and checks the role on the server.
 */
import { eq } from "drizzle-orm";
import type { Role } from "@/core/types";
import type { DbOrTx } from "../db/client";
import { users } from "../db/schema";
import { forbidden, unauthorized } from "../errors";

export { DEFAULT_USER_ID, SESSION_COOKIE } from "@/lib/session";

export interface Actor {
  id: string;
  name: string;
  role: Role;
}

export const SYSTEM_ACTOR_ID = "system";

/** The seeded demo users (§16 Phase 0). Ids are stable so the cookie survives a db reset. */
export const DEMO_USERS: readonly Actor[] = [
  { id: "user_priya", name: "Priya Raman", role: "analyst" },
  { id: "user_marcus", name: "Marcus Lee", role: "reviewer" },
  { id: "user_jordan", name: "Jordan Ellis", role: "senior_reviewer" },
  { id: "user_dana", name: "Dana Okafor", role: "policy_owner" },
];

/** A demo user's sign-in email, as the seed gives it: `priya@blink.demo` for Priya Raman. */
export const demoEmail = (name: string): string => `${name.split(" ")[0].toLowerCase()}@blink.demo`;

export const ROLE_LABEL: Record<Role, string> = {
  analyst: "Banker",
  reviewer: "Compliance reviewer",
  senior_reviewer: "Senior compliance officer",
  policy_owner: "Policy owner",
};

export function loadActor(db: DbOrTx, userId: string | undefined | null): Actor {
  if (!userId) throw unauthorized();
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) throw unauthorized(`unknown demo user "${userId}"`);
  return { id: row.id, name: row.name, role: row.role };
}

export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) {
    const allowed = roles.map((r) => ROLE_LABEL[r].toLowerCase()).join(" or ");
    throw forbidden(`this action needs a ${allowed}; you are acting as ${actor.name} (${ROLE_LABEL[actor.role].toLowerCase()})`);
  }
}

export const isReviewer = (actor: Actor) => actor.role === "reviewer" || actor.role === "senior_reviewer";

/** Reviewers see everything on a case. Analysts never see findings, restricted quotes, or unreleased briefs (§14). */
export function requireReviewer(actor: Actor): void {
  requireRole(actor, "reviewer", "senior_reviewer");
}
