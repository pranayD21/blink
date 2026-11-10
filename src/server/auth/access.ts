/**
 * Which cases an actor may touch (live guidance, section 5: "A banker can open only their own
 * cases"). Every service that takes a case id from a request goes through `requireCaseAccess`,
 * so nothing relies on a case id being hard to guess.
 *
 * - reviewer, senior_reviewer: every case.
 * - analyst (the banker): only a case they created. Any other case is `notFound("case")`, the
 *   same answer as a case that does not exist, so the id says nothing.
 * - policy_owner: no case. Forbidden, checked before the case is looked up.
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { cases } from "../db/schema";
import { forbidden, notFound } from "../errors";
import { type CaseRow, getCase } from "../services/loaders";
import type { Actor } from "./actor";

export function requireCaseAccess(db: DbOrTx, actor: Actor, caseId: string): CaseRow {
  switch (actor.role) {
    case "reviewer":
    case "senior_reviewer":
      return getCase(db, caseId);
    case "analyst": {
      const row = db.select().from(cases).where(eq(cases.id, caseId)).get();
      if (!row || row.createdBy !== actor.id) throw notFound("case");
      return row;
    }
    case "policy_owner":
      throw forbidden("cases are for bankers and compliance reviewers; the policy owner works on policies");
  }
}

/** The ids of the cases the actor may see in a list. "all" for reviewers; the policy owner sees none. */
export function visibleCaseIds(db: DbOrTx, actor: Actor): Set<string> | "all" {
  switch (actor.role) {
    case "reviewer":
    case "senior_reviewer":
      return "all";
    case "analyst":
      return new Set(db.select({ id: cases.id }).from(cases).where(eq(cases.createdBy, actor.id)).all().map((r) => r.id));
    case "policy_owner":
      return new Set();
  }
}
