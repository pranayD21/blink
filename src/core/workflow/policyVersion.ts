/**
 * The policy-version lifecycle (§8.1). Fixed code.
 *
 *   DRAFT → COMPILING → VALIDATED → ACTIVE → SUPERSEDED
 *                    ↘ COMPILE_FAILED → COMPILING (recompile)
 *
 * COMPILE_FAILED can never become ACTIVE, and ACTIVE rows are immutable.
 */
import type { Role } from "../types";

export const POLICY_STATUSES = ["DRAFT", "COMPILING", "COMPILE_FAILED", "VALIDATED", "ACTIVE", "SUPERSEDED"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export type PolicyEvent =
  | { type: "COMPILE_REQUESTED" }
  | { type: "COMPILE_SUCCEEDED" } // all blocking checks pass
  | { type: "COMPILE_FAILED" } // validation still failing after the repair budget, or a schema/refusal error
  | { type: "APPROVE"; bundleHash: string; storedBundleHash: string | null }
  | { type: "SUPERSEDE" }; // another version was activated

export type PolicyTransitionError = "FORBIDDEN_ROLE" | "INVALID_TRANSITION" | "HASH_MISMATCH";

export type PolicyTransition =
  | { ok: true; next: PolicyStatus }
  | { ok: false; error: PolicyTransitionError; message: string };

const fail = (error: PolicyTransitionError, message: string): PolicyTransition => ({ ok: false, error, message });

export function transitionPolicyVersion(status: PolicyStatus, event: PolicyEvent, actorRole: Role | "system"): PolicyTransition {
  switch (event.type) {
    case "COMPILE_REQUESTED":
      if (actorRole !== "policy_owner") return fail("FORBIDDEN_ROLE", "only the policy owner may compile a policy");
      if (status === "DRAFT" || status === "COMPILE_FAILED" || status === "VALIDATED") return { ok: true, next: "COMPILING" };
      return fail("INVALID_TRANSITION", `a policy version in ${status} cannot be compiled`);

    case "COMPILE_SUCCEEDED":
      if (actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      if (status !== "COMPILING") return fail("INVALID_TRANSITION", `compile result arrived for a version in ${status}`);
      return { ok: true, next: "VALIDATED" };

    case "COMPILE_FAILED":
      if (actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      if (status !== "COMPILING") return fail("INVALID_TRANSITION", `compile result arrived for a version in ${status}`);
      return { ok: true, next: "COMPILE_FAILED" };

    case "APPROVE":
      if (actorRole !== "policy_owner") return fail("FORBIDDEN_ROLE", "only the policy owner may approve a policy");
      if (status !== "VALIDATED") {
        return fail(
          "INVALID_TRANSITION",
          status === "COMPILE_FAILED"
            ? "this version failed compilation and can never be activated; fix the policy and recompile"
            : `only a VALIDATED version can be approved (this one is ${status})`,
        );
      }
      if (!event.storedBundleHash || event.bundleHash !== event.storedBundleHash) {
        return fail("HASH_MISMATCH", "the bundle hash you approved does not match the compiled bundle");
      }
      return { ok: true, next: "ACTIVE" };

    case "SUPERSEDE":
      if (actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      if (status !== "ACTIVE") return fail("INVALID_TRANSITION", `only an ACTIVE version can be superseded (this one is ${status})`);
      return { ok: true, next: "SUPERSEDED" };
  }
}

/** ACTIVE and SUPERSEDED versions are immutable: every update is rejected at the service layer. */
export function isImmutable(status: PolicyStatus): boolean {
  return status === "ACTIVE" || status === "SUPERSEDED";
}

export interface PolicyBundle {
  sourceText: string;
  inventory: unknown;
  rules: unknown;
  monitors: unknown;
  validation: unknown;
  scenarios: unknown;
}
