/**
 * The finding workflow (§9.2). Fixed code, not compiled from policy: a policy
 * monitor can open review work, but only this state machine — driven by a
 * person with the right role — can close it.
 */
import type { DispositionOutcome, Role } from "../types";

export const FINDING_STATES = ["NEEDS_CONTEXT", "REVIEW_REQUIRED", "NOT_TRIGGERED_PENDING_ACK", "ESCALATED", "DISPOSITIONED", "REOPENED"] as const;
export type FindingState = (typeof FINDING_STATES)[number];

export const MIN_RATIONALE_CHARS = 20;

export const REVIEWER_OUTCOMES: readonly DispositionOutcome[] = ["cleared_for_research", "restricted_exclude", "no_concern"];
export const ALL_OUTCOMES: readonly DispositionOutcome[] = ["cleared_for_research", "restricted_exclude", "restricted_escalate_to_legal", "no_concern"];

export type FindingEvent =
  // People
  | { type: "PROMOTE"; rationale: string }
  | { type: "ESCALATE"; rationale: string }
  | { type: "DISPOSE"; outcome: DispositionOutcome; rationale: string }
  // System
  | { type: "MONITOR_REVIEW_REQUIRED" }
  | { type: "MONITOR_NOT_TRIGGERED" }
  | { type: "MONITOR_NEEDS_CONTEXT" }
  | { type: "DEPENDENCY_CHANGED" }
  | { type: "REEVALUATED" };

export interface FindingGuardContext {
  actorRole: Role | "system";
  /** An open escalation task: a policy rule (REQUEST_ESCALATION) or a reviewer asked for a senior decision. */
  escalationRequired: boolean;
  /** An unresolved blocking processing issue touches this finding's claim. */
  hasOpenBlockingIssue: boolean;
}

export type TransitionError = "FORBIDDEN_ROLE" | "INVALID_TRANSITION" | "GUARD_FAILED";

export type FindingTransition =
  | { ok: true; next: FindingState; changed: boolean; decisionKind: "disposition" | "escalation_request" | "escalation_decision" | null }
  | { ok: false; error: TransitionError; message: string };

const ok = (next: FindingState, from: FindingState, decisionKind: Extract<FindingTransition, { ok: true }>["decisionKind"] = null): FindingTransition => ({
  ok: true,
  next,
  changed: next !== from,
  decisionKind,
});
const fail = (error: TransitionError, message: string): FindingTransition => ({ ok: false, error, message });

const isReviewer = (role: Role | "system") => role === "reviewer" || role === "senior_reviewer";

export function transitionFinding(state: FindingState, event: FindingEvent, ctx: FindingGuardContext): FindingTransition {
  switch (event.type) {
    case "PROMOTE": {
      if (!isReviewer(ctx.actorRole)) return fail("FORBIDDEN_ROLE", "only a reviewer can promote a finding to review");
      if (state !== "NEEDS_CONTEXT" && state !== "NOT_TRIGGERED_PENDING_ACK") return fail("INVALID_TRANSITION", `a finding in ${state} cannot be promoted`);
      if (!event.rationale.trim()) return fail("GUARD_FAILED", "a rationale is required to promote a finding");
      return ok("REVIEW_REQUIRED", state);
    }

    case "ESCALATE": {
      if (!isReviewer(ctx.actorRole)) return fail("FORBIDDEN_ROLE", "only a reviewer can escalate a finding");
      if (state !== "REVIEW_REQUIRED") return fail("INVALID_TRANSITION", `a finding in ${state} cannot be escalated`);
      if (!event.rationale.trim()) return fail("GUARD_FAILED", "a rationale is required to escalate a finding");
      return ok("ESCALATED", state, "escalation_request");
    }

    case "DISPOSE": {
      if (!isReviewer(ctx.actorRole)) return fail("FORBIDDEN_ROLE", "only a reviewer can record a disposition");
      const senior = ctx.actorRole === "senior_reviewer";
      const rationale = event.rationale.trim();

      if (state === "NOT_TRIGGERED_PENDING_ACK") {
        if (event.outcome !== "no_concern") return fail("GUARD_FAILED", "a finding whose monitors are not triggered can only be acknowledged as no_concern; promote it to review to record anything else");
        if (!rationale) return fail("GUARD_FAILED", "a rationale is required");
        return ok("DISPOSITIONED", state, "disposition");
      }
      if (state === "ESCALATED") {
        if (!senior) return fail("FORBIDDEN_ROLE", "this finding is escalated: only a senior reviewer can decide it");
      } else if (state === "REVIEW_REQUIRED") {
        if (ctx.escalationRequired && !senior) return fail("FORBIDDEN_ROLE", "policy requires escalation for this finding: only a senior reviewer can decide it");
      } else if (state === "NEEDS_CONTEXT") {
        return fail("INVALID_TRANSITION", "this finding is waiting for context: answer the clarification or promote it to review before deciding");
      } else {
        return fail("INVALID_TRANSITION", `a finding in ${state} cannot be dispositioned`);
      }

      const allowed = senior ? ALL_OUTCOMES : REVIEWER_OUTCOMES;
      if (!allowed.includes(event.outcome)) return fail("FORBIDDEN_ROLE", `outcome ${event.outcome} can only be recorded by a senior reviewer`);
      if (rationale.length < MIN_RATIONALE_CHARS) return fail("GUARD_FAILED", `the rationale must be at least ${MIN_RATIONALE_CHARS} characters`);
      if (ctx.hasOpenBlockingIssue) return fail("GUARD_FAILED", "resolve the blocking processing issue on this claim before deciding");
      return ok("DISPOSITIONED", state, state === "ESCALATED" || ctx.escalationRequired ? "escalation_decision" : "disposition");
    }

    case "MONITOR_REVIEW_REQUIRED": {
      if (ctx.actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      // Any open state moves to review; an escalated or decided finding is not pulled back by a monitor alone.
      if (state === "NEEDS_CONTEXT" || state === "NOT_TRIGGERED_PENDING_ACK" || state === "REOPENED") return ok("REVIEW_REQUIRED", state);
      return ok(state, state);
    }

    case "MONITOR_NOT_TRIGGERED": {
      if (ctx.actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      // Never a clearance: a person still has to acknowledge.
      if (state === "NEEDS_CONTEXT") return ok("NOT_TRIGGERED_PENDING_ACK", state);
      return ok(state, state);
    }

    case "MONITOR_NEEDS_CONTEXT": {
      if (ctx.actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      if (state === "NOT_TRIGGERED_PENDING_ACK") return ok("NEEDS_CONTEXT", state);
      return ok(state, state);
    }

    case "DEPENDENCY_CHANGED": {
      if (ctx.actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      if (state === "DISPOSITIONED") return ok("REOPENED", state);
      return ok(state, state);
    }

    case "REEVALUATED": {
      if (ctx.actorRole !== "system") return fail("FORBIDDEN_ROLE", "system event");
      if (state === "REOPENED") return ok("REVIEW_REQUIRED", state);
      return ok(state, state);
    }
  }
}

// ── Monitors → finding ──────────────────────────────────────────────────────

export type MonitorAggregate = "REVIEW_REQUIRED" | "NEEDS_CONTEXT" | "NOT_TRIGGERED" | "UNASSESSED";

/** The most serious state across a claim's monitors. */
export function aggregateMonitorStates(states: readonly string[]): MonitorAggregate {
  if (states.some((s) => s === "REVIEW_REQUIRED" || s === "ESCALATION_REQUESTED")) return "REVIEW_REQUIRED";
  if (states.includes("NEEDS_CONTEXT")) return "NEEDS_CONTEXT";
  if (states.includes("NOT_TRIGGERED")) return "NOT_TRIGGERED";
  return "UNASSESSED";
}

/** The system event that brings a finding in line with its monitors, if any. */
export function monitorEventFor(aggregate: MonitorAggregate): FindingEvent | null {
  switch (aggregate) {
    case "REVIEW_REQUIRED":
      return { type: "MONITOR_REVIEW_REQUIRED" };
    case "NEEDS_CONTEXT":
      return { type: "MONITOR_NEEDS_CONTEXT" };
    case "NOT_TRIGGERED":
      return { type: "MONITOR_NOT_TRIGGERED" };
    default:
      return null;
  }
}

/** The state a brand-new policy finding starts in. */
export function initialFindingState(aggregate: MonitorAggregate): FindingState | null {
  if (aggregate === "REVIEW_REQUIRED") return "REVIEW_REQUIRED";
  if (aggregate === "NEEDS_CONTEXT") return "NEEDS_CONTEXT";
  return null;
}

/** Collapses consecutive duplicates: the "mini FSM path" chips. */
export function statePath(states: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of states) if (out[out.length - 1] !== s) out.push(s);
  return out;
}
