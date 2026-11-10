/**
 * Opening an account. The role is always banker (`analyst`). A person who signs themselves up
 * cannot become compliance, and cannot read anyone else's cases.
 */
import { eq } from "drizzle-orm";
import { appendAudit } from "../audit/log";
import type { DbOrTx } from "../db/client";
import { users } from "../db/schema";
import { conflict } from "../errors";
import { newId } from "../ids";
import { hashPassword } from "./password";
import { normalizeEmail } from "./sessions";

export interface NewAccount {
  id: string;
  name: string;
  role: "analyst";
  email: string;
}

export function createAccount(tx: DbOrTx, input: { name: string; email: string; password: string }): NewAccount {
  const email = normalizeEmail(input.email);
  const name = input.name.trim();
  if (tx.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) {
    throw conflict("An account with that email already exists.", "EMAIL_TAKEN");
  }
  const id = newId("user");
  tx.insert(users).values({ id, name, role: "analyst", email, passwordHash: hashPassword(input.password) }).run();
  appendAudit(tx, { actorId: id, type: "USER_REGISTERED", entityType: "user", entityId: id, payload: { email } });
  return { id, name, role: "analyst", email };
}
