/**
 * The monitor reducer (§9.1): the only thing that turns evidence into a
 * policy-monitor state change. Pure — no I/O, no clock, no model.
 *
 * Given a monitor, its rule's guard, the current state, an event, and a
 * pinned snapshot of predicate assessments, it picks at most one transition.
 * No match means "state unchanged, AUDIT_ONLY": that is logged and never
 * treated as clearance.
 */
import { and, not, or, toTri } from "../logic/kleene";
import type { GuardExpr, Monitor, Transition } from "../policy/schema";
import { predicateKey } from "../predicates/registry";
import type { PredicateParams } from "../predicates/registry";
import type { EvidenceState, Tri } from "../types";

export type GuardTraceNode =
  | { op: "pred"; key: string; name: string; params: PredicateParams; state: EvidenceState; tri: Tri }
  | { op: "and" | "or"; tri: Tri; children: GuardTraceNode[] }
  | { op: "not"; tri: Tri; children: [GuardTraceNode] };

export interface MonitorEvent {
  id: string;
  type: "CLAIM_EVALUATED" | "CONTEXT_UPDATED";
  seq: number;
}

export interface ReduceInput {
  monitor: Monitor;
  /** The rule's guard, already rebuilt and validated. */
  guard: GuardExpr;
  state: string;
  event: MonitorEvent;
  /** Pinned snapshot: predicate key → evidence state. A missing key reads as unknown. */
  assessments: Readonly<Record<string, EvidenceState>>;
}

export interface ReduceOutput {
  nextState: string;
  transitionId: string | null;
  result: Tri;
  /** Every node's tri-value and the leaf evidence states. */
  guardTrace: GuardTraceNode;
  /** Proposed effects; the workflow decides what to do with them. */
  effects: string[];
  /** True when any predicate in the guard is in conflict. The service opens a review task regardless of the transition. */
  conflictFlag: boolean;
}

/** Evaluates a guard under an assignment, recording every node's value. */
export function evaluateGuard(guard: GuardExpr, assessments: Readonly<Record<string, EvidenceState>>): GuardTraceNode {
  switch (guard.op) {
    case "pred": {
      const key = predicateKey(guard.name, guard.params);
      const state = assessments[key] ?? "unknown";
      return { op: "pred", key, name: guard.name, params: guard.params ?? {}, state, tri: toTri(state) };
    }
    case "not": {
      const child = evaluateGuard(guard.arg, assessments);
      return { op: "not", tri: not(child.tri), children: [child] };
    }
    case "and":
    case "or": {
      const children = guard.args.map((arg) => evaluateGuard(arg, assessments));
      const tris = children.map((c) => c.tri);
      return { op: guard.op, tri: guard.op === "and" ? and(tris) : or(tris), children };
    }
  }
}

export function traceHasConflict(node: GuardTraceNode): boolean {
  if (node.op === "pred") return node.state === "conflict";
  return node.children.some(traceHasConflict);
}

/** Leaves of a trace, in order. */
export function traceLeaves(node: GuardTraceNode): Extract<GuardTraceNode, { op: "pred" }>[] {
  if (node.op === "pred") return [node];
  return node.children.flatMap(traceLeaves);
}

/** Transitions that match (state, event, result), highest priority first. */
export function matchingTransitions(monitor: Monitor, state: string, eventType: string, result: Tri): Transition[] {
  return monitor.transitions
    .filter((t) => t.event === eventType && t.result_is === result && t.from.includes(state))
    .sort((a, b) => b.priority - a.priority);
}

export class NondeterministicMonitorError extends Error {
  constructor(
    readonly monitorId: string,
    readonly transitionIds: string[],
  ) {
    super(`monitor ${monitorId}: transitions ${transitionIds.join(", ")} match at equal priority`);
    this.name = "NondeterministicMonitorError";
  }
}

export function reduceMonitor(input: ReduceInput): ReduceOutput {
  const guardTrace = evaluateGuard(input.guard, input.assessments);
  const result = guardTrace.tri;
  const conflictFlag = traceHasConflict(guardTrace);
  const matches = matchingTransitions(input.monitor, input.state, input.event.type, result);

  if (matches.length === 0) {
    return { nextState: input.state, transitionId: null, result, guardTrace, effects: ["AUDIT_ONLY"], conflictFlag };
  }
  // The validator proves this cannot happen for an activated policy (NONDETERMINISTIC).
  // If it ever does, stop rather than pick one arbitrarily.
  if (matches.length > 1 && matches[1].priority === matches[0].priority) {
    const tied = matches.filter((t) => t.priority === matches[0].priority).map((t) => t.id);
    throw new NondeterministicMonitorError(input.monitor.monitor_id, tied);
  }
  const chosen = matches[0];
  return {
    nextState: chosen.to,
    transitionId: chosen.id,
    result,
    guardTrace,
    effects: chosen.effects.length > 0 ? [...chosen.effects] : ["AUDIT_ONLY"],
    conflictFlag,
  };
}
