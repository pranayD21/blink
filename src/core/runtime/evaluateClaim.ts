/**
 * Runs one claim through every monitor of a policy (§9.1). Pure.
 *
 * Turn-ordered mode is used on the first analysis of a transcript: a
 * conversation reveals facts in order, so one CLAIM_EVALUATED event is
 * emitted for each turn that adds a quote to the claim, and each event sees
 * only the fields supported by quotes up to that turn. The last event sees
 * the whole claim. Later re-evaluations emit a single event with the full
 * snapshot.
 */
import type { Monitor } from "../policy/schema";
import { collectPredicates } from "../policy/schema";
import type { CompiledRule } from "../policy/validate";
import { type Assessment, type EvaluationEnv, type EvaluationScope, assessClaim, fullScope, quoteTurns, scopeAtTurn, statesOf } from "../predicates/evaluate";
import type { ClaimRecord, Tri } from "../types";
import { type GuardTraceNode, type MonitorEvent, reduceMonitor } from "./monitorReducer";

export interface CompiledPolicy {
  rules: Map<string, CompiledRule>;
  monitors: Monitor[];
}

export interface MonitorStep {
  eventId: string;
  eventType: MonitorEvent["type"];
  /** "T5" on a turn-ordered event; null on a full-snapshot event. */
  turnLabel: string | null;
  prevState: string;
  nextState: string;
  transitionId: string | null;
  result: Tri;
  effects: string[];
  conflictFlag: boolean;
  guardTrace: GuardTraceNode;
  assessments: Record<string, Assessment>;
}

export interface MonitorRun {
  monitorId: string;
  ruleId: string;
  startState: string;
  finalState: string;
  steps: MonitorStep[];
}

export interface ClaimEvaluation {
  logicalKey: string;
  monitors: MonitorRun[];
  /** Assessments of every predicate any rule uses, under the full snapshot. */
  finalAssessments: Record<string, Assessment>;
}

export interface EvaluateClaimInput {
  claim: ClaimRecord;
  policy: CompiledPolicy;
  env: EvaluationEnv;
  mode: "turn_ordered" | "full";
  eventType: MonitorEvent["type"];
  /** Stable prefix for event ids; the same prefix on a replay yields the same ids (dedupe). */
  eventIdPrefix: string;
  /** Current state per monitor id; a missing entry starts at the monitor's initial state. */
  currentStates?: Readonly<Record<string, string>>;
}

export function evaluateClaim(input: EvaluateClaimInput): ClaimEvaluation {
  const { claim, policy, env } = input;
  const turns = input.mode === "turn_ordered" ? quoteTurns(claim) : [];

  // One scope per event. The final event always sees the whole claim.
  const scopes: { scope: EvaluationScope; turnLabel: string | null; suffix: string }[] = [];
  if (turns.length > 1) {
    turns.forEach((t, i) => {
      const last = i === turns.length - 1;
      scopes.push({ scope: last ? { ...fullScope(claim), asOfTurnLabel: null } : scopeAtTurn(claim, t.turnIdx), turnLabel: t.turnLabel, suffix: t.turnLabel });
    });
  } else {
    scopes.push({ scope: fullScope(claim), turnLabel: turns[0]?.turnLabel ?? null, suffix: turns[0]?.turnLabel ?? "full" });
  }

  const allUses = new Map<string, { name: string; params: Record<string, number | string> }>();
  for (const { guard } of policy.rules.values()) {
    for (const use of collectPredicates(guard)) allUses.set(use.key, { name: use.name, params: use.params });
  }
  const uses = [...allUses.values()];
  const assessmentsPerScope = scopes.map((s) => assessClaim(uses, claim, env, s.scope));

  const monitors: MonitorRun[] = [];
  for (const monitor of policy.monitors) {
    const compiled = policy.rules.get(monitor.rule_id);
    if (!compiled) continue;
    const startState = input.currentStates?.[monitor.monitor_id] ?? monitor.initial_state;
    let state = startState;
    const steps: MonitorStep[] = [];
    scopes.forEach((s, i) => {
      const assessments = assessmentsPerScope[i];
      const event: MonitorEvent = { id: `${input.eventIdPrefix}:${s.suffix}`, type: input.eventType, seq: i + 1 };
      const out = reduceMonitor({ monitor, guard: compiled.guard, state, event, assessments: statesOf(assessments) });
      const used = Object.fromEntries(collectPredicates(compiled.guard).map((u) => [u.key, assessments[u.key]]));
      steps.push({
        eventId: event.id,
        eventType: event.type,
        turnLabel: s.turnLabel,
        prevState: state,
        nextState: out.nextState,
        transitionId: out.transitionId,
        result: out.result,
        effects: out.effects,
        conflictFlag: out.conflictFlag,
        guardTrace: out.guardTrace,
        assessments: used,
      });
      state = out.nextState;
    });
    monitors.push({ monitorId: monitor.monitor_id, ruleId: monitor.rule_id, startState, finalState: state, steps });
  }

  return { logicalKey: claim.logicalKey, monitors, finalAssessments: assessmentsPerScope[assessmentsPerScope.length - 1] };
}
