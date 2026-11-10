/**
 * Scenario tests (§8.6): traces of evidence assignments run through the real
 * monitor reducer and compared with an expected outcome.
 *
 * Reviewer-authored scenarios are the activation gate (a mismatch is the
 * blocking issue SCENARIO_FAILED). AI-proposed scenarios are shown as
 * warnings only and are never claimed as proof.
 */
import { z } from "zod";
import { NondeterministicMonitorError, reduceMonitor } from "../runtime/monitorReducer";
import type { EvidenceState } from "../types";
import type { Inventory, Monitor, PolicyParagraph, RulesDoc } from "./schema";
import { MONITOR_EVENTS, collectPredicates } from "./schema";
import type { CompiledRule, ValidationIssue } from "./validate";
import { locateQuote } from "../evidence/quote";

const EvidenceStateSchema = z.enum(["supported", "refuted", "unknown", "conflict"]);

export const ScenarioSchema = z.strictObject({
  name: z.string().min(1),
  /** The rule this scenario targets, as the reviewer expects it to be numbered. */
  rule_id: z.string().min(1),
  /**
   * The policy paragraph the rule implements. When present it is used to find
   * the rule, so a scenario still binds to the right rule if a compile
   * numbers its rules differently.
   */
  source_paragraph: z.string().optional(),
  note: z.string().optional(),
  steps: z
    .array(
      z.strictObject({
        event: z.enum(MONITOR_EVENTS),
        /** Predicate name (or `name(param=value)` key) → evidence state. Every predicate in the rule's guard must be assigned. */
        assignment: z.record(z.string(), EvidenceStateSchema),
        /** Optional check after this step. */
        expect_state: z.string().optional(),
        expect_effects: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  expect: z.strictObject({
    final_state: z.string(),
    /** Effects the final step must include. */
    effects: z.array(z.string()),
    /** When set, the final step must (not) raise the conflict flag. */
    conflict_flag: z.boolean().optional(),
    /** When true, the final step must match no transition (state unchanged, AUDIT_ONLY). */
    no_transition: z.boolean().optional(),
  }),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const ScenarioFileSchema = z.strictObject({
  policy: z.string().optional(),
  authored_by: z.string().optional(),
  scenarios: z.array(ScenarioSchema),
});
export type ScenarioFile = z.infer<typeof ScenarioFileSchema>;

/** Model-facing schema for AI-proposed scenarios (no records in structured outputs). */
export const LlmScenariosSchema = z.object({
  scenarios: z.array(
    z.object({
      name: z.string(),
      rule_id: z.string(),
      rationale: z.string(),
      steps: z.array(
        z.object({
          event: z.enum(MONITOR_EVENTS),
          assignment: z.array(z.object({ predicate: z.string(), state: EvidenceStateSchema })),
        }),
      ),
      expect_final_state: z.string(),
      expect_effects: z.array(z.string()),
    }),
  ),
});
export type LlmScenarios = z.infer<typeof LlmScenariosSchema>;

export function llmScenariosToScenarios(doc: LlmScenarios): Scenario[] {
  return doc.scenarios.map((s) => ({
    name: s.name,
    rule_id: s.rule_id,
    note: s.rationale,
    steps: s.steps.map((step) => ({
      event: step.event,
      assignment: Object.fromEntries(step.assignment.map((a) => [a.predicate, a.state])),
    })),
    expect: { final_state: s.expect_final_state, effects: s.expect_effects },
  }));
}

export interface ScenarioStepResult {
  event: string;
  result: string;
  state_before: string;
  state_after: string;
  transition_id: string | null;
  effects: string[];
  conflict_flag: boolean;
}

export interface ScenarioResult {
  name: string;
  rule_id: string;
  resolved_rule_id: string | null;
  pass: boolean;
  failures: string[];
  steps: ScenarioStepResult[];
  expect: Scenario["expect"];
  note?: string;
}

export interface ScenarioReport {
  source: "reviewer" | "ai";
  total: number;
  passed: number;
  failed: number;
  results: ScenarioResult[];
}

export interface ScenarioPolicy {
  rules: Map<string, CompiledRule>;
  monitors: Monitor[];
  /** Needed only to resolve `source_paragraph`. */
  inventory?: Inventory | null;
  paragraphs?: PolicyParagraph[] | null;
}

/** Finds the rule a scenario targets: by source paragraph when given, else by rule id. */
export function resolveScenarioRule(scenario: Scenario, policy: ScenarioPolicy): { ruleId: string | null; problem?: string } {
  if (scenario.source_paragraph && policy.inventory) {
    const paragraphs = policy.paragraphs ?? [];
    const clauseIds = new Set(
      policy.inventory.clauses
        .filter((c) => {
          const stated = paragraphs.find((p) => p.id === c.paragraph);
          if (stated && locateQuote(stated.text, c.verbatim)) return stated.id === scenario.source_paragraph;
          const found = paragraphs.find((p) => locateQuote(p.text, c.verbatim));
          return (found?.id ?? c.paragraph) === scenario.source_paragraph;
        })
        .map((c) => c.clause_id),
    );
    const matches = [...policy.rules.values()].filter((r) => r.rule.source_clause_ids.some((id) => clauseIds.has(id)));
    if (matches.length === 1) return { ruleId: matches[0].rule.rule_id };
    if (matches.length > 1) {
      const byId = matches.find((m) => m.rule.rule_id === scenario.rule_id);
      if (byId) return { ruleId: byId.rule.rule_id };
      return { ruleId: null, problem: `paragraph ${scenario.source_paragraph} is implemented by several rules (${matches.map((m) => m.rule.rule_id).join(", ")})` };
    }
    return { ruleId: null, problem: `no rule implements paragraph ${scenario.source_paragraph}` };
  }
  if (policy.rules.has(scenario.rule_id)) return { ruleId: scenario.rule_id };
  return { ruleId: null, problem: `rule ${scenario.rule_id} does not exist` };
}

export function runScenario(scenario: Scenario, policy: ScenarioPolicy): ScenarioResult {
  const failures: string[] = [];
  const steps: ScenarioStepResult[] = [];
  const base = { name: scenario.name, rule_id: scenario.rule_id, expect: scenario.expect, note: scenario.note };

  const resolved = resolveScenarioRule(scenario, policy);
  if (!resolved.ruleId) {
    return { ...base, resolved_rule_id: null, pass: false, failures: [resolved.problem ?? "rule not found"], steps };
  }
  const compiled = policy.rules.get(resolved.ruleId)!;
  const monitor = policy.monitors.find((m) => m.rule_id === resolved.ruleId);
  if (!monitor) {
    return { ...base, resolved_rule_id: resolved.ruleId, pass: false, failures: [`rule ${resolved.ruleId} has no monitor`], steps };
  }

  const uses = collectPredicates(compiled.guard);
  let state: string = monitor.initial_state;

  for (const [index, step] of scenario.steps.entries()) {
    // Bind the scenario's assignment (by key, or by bare name) to the guard's predicates.
    const assessments: Record<string, EvidenceState> = {};
    for (const use of uses) {
      const value = step.assignment[use.key] ?? step.assignment[use.name];
      if (value === undefined) {
        failures.push(`step ${index + 1}: the rule's guard uses ${use.key}, which this scenario does not assign`);
        continue;
      }
      assessments[use.key] = value;
    }
    let out: ReturnType<typeof reduceMonitor>;
    try {
      out = reduceMonitor({
        monitor,
        guard: compiled.guard,
        state,
        event: { id: `scenario:${scenario.name}:${index + 1}`, type: step.event, seq: index + 1 },
        assessments,
      });
    } catch (err) {
      // A monitor the validator already rejected (two transitions tied) has no defined behavior to test.
      if (!(err instanceof NondeterministicMonitorError)) throw err;
      return { ...base, resolved_rule_id: resolved.ruleId, pass: false, failures: [...failures, `step ${index + 1}: ${err.message}`], steps };
    }
    steps.push({
      event: step.event,
      result: out.result,
      state_before: state,
      state_after: out.nextState,
      transition_id: out.transitionId,
      effects: out.effects,
      conflict_flag: out.conflictFlag,
    });
    state = out.nextState;
    if (step.expect_state && step.expect_state !== out.nextState) {
      failures.push(`step ${index + 1}: expected state ${step.expect_state}, got ${out.nextState}`);
    }
    for (const effect of step.expect_effects ?? []) {
      if (!out.effects.includes(effect)) failures.push(`step ${index + 1}: expected effect ${effect}, got [${out.effects.join(", ")}]`);
    }
  }

  const last = steps[steps.length - 1];
  if (state !== scenario.expect.final_state) failures.push(`expected final state ${scenario.expect.final_state}, got ${state}`);
  for (const effect of scenario.expect.effects) {
    if (!last.effects.includes(effect)) failures.push(`expected effect ${effect}, got [${last.effects.join(", ")}]`);
  }
  if (scenario.expect.conflict_flag !== undefined && scenario.expect.conflict_flag !== last.conflict_flag) {
    failures.push(`expected conflict flag ${scenario.expect.conflict_flag}, got ${last.conflict_flag}`);
  }
  if (scenario.expect.no_transition && last.transition_id !== null) {
    failures.push(`expected no transition, but ${last.transition_id} fired`);
  }

  return { ...base, resolved_rule_id: resolved.ruleId, pass: failures.length === 0, failures, steps };
}

export function runScenarios(scenarios: readonly Scenario[], policy: ScenarioPolicy, source: "reviewer" | "ai"): ScenarioReport {
  const results = scenarios.map((s) => runScenario(s, policy));
  const passed = results.filter((r) => r.pass).length;
  return { source, total: results.length, passed, failed: results.length - passed, results };
}

/** Reviewer-authored mismatches block activation; AI-proposed disagreements are warnings. */
export function scenarioIssues(report: ScenarioReport): ValidationIssue[] {
  return report.results
    .filter((r) => !r.pass)
    .map((r) => ({
      code: "SCENARIO_FAILED" as const,
      severity: report.source === "reviewer" ? ("blocking" as const) : ("warning" as const),
      rule_id: r.resolved_rule_id ?? r.rule_id,
      message: `${report.source === "reviewer" ? "reviewer scenario" : "AI-proposed scenario"} "${r.name}": ${r.failures.join("; ")}`,
    }));
}

export function rulesDocOf(compiled: Map<string, CompiledRule>): RulesDoc["rules"] {
  return [...compiled.values()].map((c) => c.rule);
}
