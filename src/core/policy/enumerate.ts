/**
 * Exhaustive enumeration (§8.5, decision D8).
 *
 * For a monitor whose guard uses predicates p1…pk, iterate all 4^k
 * assignments over {supported, refuted, unknown, conflict}. This proves
 * determinism (no two transitions fire together at equal priority) for every
 * reachable combination of evidence, and reports outcome counts and coverage.
 */
import { matchingTransitions, evaluateGuard } from "../runtime/monitorReducer";
import type { EvidenceState, Tri } from "../types";
import { EVIDENCE_STATES, TRI_VALUES } from "../types";
import type { GuardExpr, Monitor } from "./schema";
import { MONITOR_EVENTS, collectPredicates } from "./schema";

export interface DeterminismCounterexample {
  state: string;
  event: string;
  result: Tri;
  assignment: Record<string, EvidenceState>;
  transitions: string[];
}

export interface EnumerationReport {
  monitor_id: string;
  rule_id: string;
  predicates: string[];
  combinations: number;
  outcomes: Record<Tri, number>;
  determinism: { pass: boolean; counterexamples: DeterminismCounterexample[] };
  coverage: { handled: number; total: number; fraction: number; unhandled: { state: string; event: string; result: Tri }[] };
  /** From UNASSESSED on CLAIM_EVALUATED, an indeterminate result has a handling transition. */
  indeterminate_handled: boolean;
  reachable_states: string[];
  unreachable_states: string[];
}

const MAX_COUNTEREXAMPLES = 5;

/** Calls `visit` once per assignment of the four evidence states to `keys` (4^k calls). */
export function forEachAssignment(keys: readonly string[], visit: (assignment: Record<string, EvidenceState>) => void): number {
  const total = 4 ** keys.length;
  for (let n = 0; n < total; n++) {
    const assignment: Record<string, EvidenceState> = {};
    let rest = n;
    for (const key of keys) {
      assignment[key] = EVIDENCE_STATES[rest % 4];
      rest = Math.floor(rest / 4);
    }
    visit(assignment);
  }
  return total;
}

export function enumerateMonitor(monitor: Monitor, guard: GuardExpr): EnumerationReport {
  const predicates = collectPredicates(guard).map((p) => p.key);
  const outcomes: Record<Tri, number> = { true: 0, false: 0, indeterminate: 0 };
  /** One witness assignment per achievable result, used for counterexamples. */
  const witness: Partial<Record<Tri, Record<string, EvidenceState>>> = {};
  const counterexamples: DeterminismCounterexample[] = [];
  const seenConflicts = new Set<string>();

  const combinations = forEachAssignment(predicates, (assignment) => {
    const result = evaluateGuard(guard, assignment).tri;
    outcomes[result]++;
    witness[result] ??= assignment;
    for (const state of monitor.states) {
      for (const event of MONITOR_EVENTS) {
        const matches = matchingTransitions(monitor, state, event, result);
        if (matches.length > 1 && matches[0].priority === matches[1].priority) {
          const id = `${state}|${event}|${result}`;
          if (seenConflicts.has(id)) continue;
          seenConflicts.add(id);
          if (counterexamples.length < MAX_COUNTEREXAMPLES) {
            counterexamples.push({
              state,
              event,
              result,
              assignment,
              transitions: matches.filter((t) => t.priority === matches[0].priority).map((t) => t.id),
            });
          }
        }
      }
    }
  });

  // Coverage over (state, event, result) triples.
  const unhandled: { state: string; event: string; result: Tri }[] = [];
  let handled = 0;
  let total = 0;
  for (const state of monitor.states) {
    for (const event of MONITOR_EVENTS) {
      for (const result of TRI_VALUES) {
        total++;
        if (matchingTransitions(monitor, state, event, result).length > 0) handled++;
        else unhandled.push({ state, event, result });
      }
    }
  }

  // Reachability: BFS over transitions whose result some assignment can produce.
  const achievable = TRI_VALUES.filter((r) => outcomes[r] > 0);
  const reachable = new Set<string>([monitor.initial_state]);
  const queue = [monitor.initial_state as string];
  while (queue.length > 0) {
    const state = queue.shift()!;
    for (const event of MONITOR_EVENTS) {
      for (const result of achievable) {
        const next = matchingTransitions(monitor, state, event, result)[0]?.to;
        if (next && !reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
  }

  return {
    monitor_id: monitor.monitor_id,
    rule_id: monitor.rule_id,
    predicates,
    combinations,
    outcomes,
    determinism: { pass: seenConflicts.size === 0, counterexamples },
    coverage: { handled, total, fraction: total === 0 ? 0 : handled / total, unhandled },
    indeterminate_handled: matchingTransitions(monitor, "UNASSESSED", "CLAIM_EVALUATED", "indeterminate").length > 0,
    reachable_states: monitor.states.filter((s) => reachable.has(s)),
    unreachable_states: monitor.states.filter((s) => !reachable.has(s)),
  };
}
