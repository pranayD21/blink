/**
 * The policy validator (§8.5). Deterministic; no model involved.
 *
 * Every check emits `{code, severity, …, message}`. Any blocking issue stops
 * activation: a compiled policy fails closed. Codes beyond the spec's table
 * (CLAUSE_REF_UNKNOWN, MONITOR_RULE_MISMATCH, RULE_EFFECT_MISMATCH) are
 * additional blocking checks in the same spirit: a rule must trace to real
 * clauses, every rule must have exactly one monitor, and a monitor must
 * actually do what its rule declares.
 */
import { locateQuote } from "../evidence/quote";
import { checkParams, isPredicateName } from "../predicates/registry";
import { type EnumerationReport, enumerateMonitor } from "./enumerate";
import {
  ACTIONABLE_CLAUSE_KINDS,
  ALLOWED_EFFECTS,
  type GuardExpr,
  type Inventory,
  MAX_PREDICATES_PER_GUARD,
  MONITOR_STATES,
  type Monitor,
  MonitorsDocSchema,
  type PolicyParagraph,
  type Rule,
  type RulesDoc,
  RulesDocSchema,
  buildGuardTree,
  collectPredicates,
} from "./schema";

export type IssueCode =
  | "SCHEMA_INVALID"
  | "DUPLICATE_ID"
  | "UNKNOWN_PREDICATE"
  | "BAD_PARAM"
  | "GUARD_MALFORMED"
  | "BAD_ENDPOINT"
  | "FORBIDDEN_EFFECT"
  | "NONDETERMINISTIC"
  | "UNREACHABLE_STATE"
  | "INDETERMINATE_UNHANDLED"
  | "TOO_MANY_PREDICATES"
  | "CLAUSE_DROPPED"
  | "CLAUSE_NOT_IN_SOURCE"
  | "PARAGRAPH_UNCOVERED"
  | "SCENARIO_FAILED"
  | "CLAUSE_REF_UNKNOWN"
  | "MONITOR_RULE_MISMATCH"
  | "RULE_EFFECT_MISMATCH";

export interface ValidationIssue {
  code: IssueCode;
  severity: "blocking" | "warning";
  rule_id?: string;
  monitor_id?: string;
  transition_id?: string;
  clause_id?: string;
  paragraph?: string;
  /** For NONDETERMINISTIC: one concrete evidence assignment in which two transitions both match. */
  counterexample?: { state: string; event: string; result: string; assignment: Record<string, string>; transitions: string[] };
  message: string;
}

/** Blockers the assembly step can fix by re-emitting monitors (§8.7). */
export const ASSEMBLY_LEVEL_CODES: readonly IssueCode[] = [
  "BAD_ENDPOINT",
  "NONDETERMINISTIC",
  "INDETERMINATE_UNHANDLED",
  "FORBIDDEN_EFFECT",
  "DUPLICATE_ID",
  "MONITOR_RULE_MISMATCH",
  "RULE_EFFECT_MISMATCH",
];
/** Blockers that need the rules to be re-extracted (§8.7). */
export const RULE_LEVEL_CODES: readonly IssueCode[] = [
  "UNKNOWN_PREDICATE",
  "CLAUSE_DROPPED",
  "GUARD_MALFORMED",
  "BAD_PARAM",
  "TOO_MANY_PREDICATES",
  "CLAUSE_REF_UNKNOWN",
];

export interface CompiledRule {
  rule: Rule;
  guard: GuardExpr;
}

export interface ValidationInput {
  /** Policy source; omit to skip the source-coverage checks (unit tests of monitors alone). */
  source?: { paragraphs: PolicyParagraph[]; requiredParagraphs: string[] } | null;
  inventory?: Inventory | null;
  rulesDoc: unknown;
  monitorsDoc: unknown;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
  enumeration: EnumerationReport[];
  totals: {
    monitors: number;
    combinations: number;
    deterministic: boolean;
    indeterminate_handled: boolean;
  };
}

const blocking = (issue: Omit<ValidationIssue, "severity">): ValidationIssue => ({ ...issue, severity: "blocking" });
const warning = (issue: Omit<ValidationIssue, "severity">): ValidationIssue => ({ ...issue, severity: "warning" });

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

function formatZodPath(path: PropertyKey[]): string {
  return path.map((p) => (typeof p === "number" ? `[${p}]` : String(p))).join(".").replaceAll(".[", "[");
}

/** Checks the inventory against the source text (§8.2). */
export function validateInventory(inventory: Inventory, paragraphs: PolicyParagraph[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  for (const id of duplicates(inventory.clauses.map((c) => c.clause_id))) {
    issues.push(blocking({ code: "DUPLICATE_ID", clause_id: id, message: `clause id ${id} is used more than once` }));
  }
  const covered = new Set<string>();
  for (const clause of inventory.clauses) {
    const paragraph = byId.get(clause.paragraph);
    const inStated = paragraph ? locateQuote(paragraph.text, clause.verbatim) : null;
    if (inStated) {
      covered.add(clause.paragraph);
      continue;
    }
    const elsewhere = paragraphs.find((p) => locateQuote(p.text, clause.verbatim));
    if (elsewhere) {
      // The text is real but the model named the wrong paragraph; the source wins.
      covered.add(elsewhere.id);
      issues.push(
        warning({
          code: "CLAUSE_NOT_IN_SOURCE",
          clause_id: clause.clause_id,
          paragraph: clause.paragraph,
          message: `clause ${clause.clause_id} cites ${clause.paragraph} but its text is in ${elsewhere.id}`,
        }),
      );
      continue;
    }
    issues.push(
      blocking({
        code: "CLAUSE_NOT_IN_SOURCE",
        clause_id: clause.clause_id,
        paragraph: clause.paragraph,
        message: `clause ${clause.clause_id} quotes text that does not appear in the policy: "${clause.verbatim.slice(0, 80)}${clause.verbatim.length > 80 ? "…" : ""}"`,
      }),
    );
  }
  for (const p of paragraphs) {
    if (!covered.has(p.id)) {
      issues.push(warning({ code: "PARAGRAPH_UNCOVERED", paragraph: p.id, message: `paragraph ${p.id} is not covered by any clause` }));
    }
  }
  return issues;
}

/** Which paragraph each clause actually sits in (by text), falling back to the model's label. */
function clauseParagraphs(inventory: Inventory, paragraphs: PolicyParagraph[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const clause of inventory.clauses) {
    const stated = paragraphs.find((p) => p.id === clause.paragraph);
    if (stated && locateQuote(stated.text, clause.verbatim)) {
      out.set(clause.clause_id, stated.id);
      continue;
    }
    const found = paragraphs.find((p) => locateQuote(p.text, clause.verbatim));
    out.set(clause.clause_id, found?.id ?? clause.paragraph);
  }
  return out;
}

/** §8.3 coverage: no actionable clause may be silently dropped. */
export function validateCoverage(
  inventory: Inventory,
  rulesDoc: RulesDoc,
  source: { paragraphs: PolicyParagraph[]; requiredParagraphs: string[] },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const clauseIds = new Set(inventory.clauses.map((c) => c.clause_id));
  const inRule = new Set<string>();
  for (const rule of rulesDoc.rules) {
    for (const id of [...rule.source_clause_ids, ...rule.exception_clause_ids]) {
      inRule.add(id);
      if (!clauseIds.has(id)) {
        issues.push(blocking({ code: "CLAUSE_REF_UNKNOWN", rule_id: rule.rule_id, clause_id: id, message: `rule ${rule.rule_id} cites clause ${id}, which is not in the inventory` }));
      }
    }
    if (rule.source_clause_ids.length === 0) {
      issues.push(blocking({ code: "CLAUSE_REF_UNKNOWN", rule_id: rule.rule_id, message: `rule ${rule.rule_id} cites no source clause` }));
    }
  }
  const unsupported = new Set(rulesDoc.unsupported_clauses.map((u) => u.clause_id));
  for (const id of unsupported) {
    if (!clauseIds.has(id)) {
      issues.push(blocking({ code: "CLAUSE_REF_UNKNOWN", clause_id: id, message: `unsupported_clauses lists ${id}, which is not in the inventory` }));
    }
  }

  const paragraphOf = clauseParagraphs(inventory, source.paragraphs);
  const required = new Set(source.requiredParagraphs);

  for (const clause of inventory.clauses) {
    const paragraph = paragraphOf.get(clause.clause_id) ?? clause.paragraph;
    if (ACTIONABLE_CLAUSE_KINDS.includes(clause.kind) && !inRule.has(clause.clause_id) && !unsupported.has(clause.clause_id)) {
      issues.push(
        blocking({
          code: "CLAUSE_DROPPED",
          clause_id: clause.clause_id,
          paragraph,
          message: `${clause.kind} clause ${clause.clause_id} (${paragraph}) is in no rule and is not listed as unsupported`,
        }),
      );
    }
    if (required.has(paragraph) && unsupported.has(clause.clause_id) && !inRule.has(clause.clause_id)) {
      issues.push(
        blocking({
          code: "CLAUSE_DROPPED",
          clause_id: clause.clause_id,
          paragraph,
          message: `clause ${clause.clause_id} is from required paragraph ${paragraph} but was left unsupported: the policy owner marked ${paragraph} as must-be-automated`,
        }),
      );
    }
  }
  for (const paragraph of required) {
    const clauses = inventory.clauses.filter((c) => (paragraphOf.get(c.clause_id) ?? c.paragraph) === paragraph);
    if (!clauses.some((c) => inRule.has(c.clause_id))) {
      const already = issues.some((i) => i.code === "CLAUSE_DROPPED" && i.paragraph === paragraph);
      if (!already) {
        issues.push(blocking({ code: "CLAUSE_DROPPED", paragraph, message: `required paragraph ${paragraph} is not automated by any rule` }));
      }
    }
  }
  return issues;
}

function validateRules(rulesDoc: RulesDoc): { issues: ValidationIssue[]; compiled: Map<string, CompiledRule> } {
  const issues: ValidationIssue[] = [];
  const compiled = new Map<string, CompiledRule>();
  for (const id of duplicates(rulesDoc.rules.map((r) => r.rule_id))) {
    issues.push(blocking({ code: "DUPLICATE_ID", rule_id: id, message: `rule id ${id} is used more than once` }));
  }
  for (const rule of rulesDoc.rules) {
    const built = buildGuardTree(rule.guard);
    if (!built.ok) {
      issues.push(blocking({ code: "GUARD_MALFORMED", rule_id: rule.rule_id, message: `rule ${rule.rule_id}: ${built.reason}` }));
      continue;
    }
    const uses = collectPredicates(built.tree);
    let usable = true;
    for (const use of uses) {
      if (!isPredicateName(use.name)) {
        usable = false;
        issues.push(blocking({ code: "UNKNOWN_PREDICATE", rule_id: rule.rule_id, message: `rule ${rule.rule_id} uses "${use.name}", which is not in the predicate registry` }));
        continue;
      }
      for (const problem of checkParams(use.name, use.params)) {
        usable = false;
        issues.push(blocking({ code: "BAD_PARAM", rule_id: rule.rule_id, message: `rule ${rule.rule_id}: ${problem}` }));
      }
    }
    if (uses.length > MAX_PREDICATES_PER_GUARD) {
      usable = false;
      issues.push(blocking({ code: "TOO_MANY_PREDICATES", rule_id: rule.rule_id, message: `rule ${rule.rule_id} uses ${uses.length} distinct predicates; the limit is ${MAX_PREDICATES_PER_GUARD}` }));
    }
    if (usable && !compiled.has(rule.rule_id)) compiled.set(rule.rule_id, { rule, guard: built.tree });
  }
  return { issues, compiled };
}

function validateMonitorStructure(monitor: Monitor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const id = monitor.monitor_id;
  const allowedStates = new Set<string>(MONITOR_STATES);
  const declared = new Set(monitor.states);
  for (const state of monitor.states) {
    if (!allowedStates.has(state)) {
      issues.push(blocking({ code: "BAD_ENDPOINT", monitor_id: id, message: `monitor ${id} declares state "${state}", which is not in the monitor vocabulary` }));
    }
  }
  for (const dup of duplicates(monitor.states)) {
    issues.push(blocking({ code: "DUPLICATE_ID", monitor_id: id, message: `monitor ${id} declares state ${dup} more than once` }));
  }
  if (!declared.has(monitor.initial_state)) {
    issues.push(blocking({ code: "BAD_ENDPOINT", monitor_id: id, message: `monitor ${id}: initial state ${monitor.initial_state} is not in its states` }));
  }
  for (const dup of duplicates(monitor.transitions.map((t) => t.id))) {
    issues.push(blocking({ code: "DUPLICATE_ID", monitor_id: id, transition_id: dup, message: `monitor ${id}: transition id ${dup} is used more than once` }));
  }
  const allowedEffects = new Set<string>(ALLOWED_EFFECTS);
  for (const t of monitor.transitions) {
    if (t.from.length === 0) {
      issues.push(blocking({ code: "BAD_ENDPOINT", monitor_id: id, transition_id: t.id, message: `monitor ${id}: transition ${t.id} has no source state` }));
    }
    for (const from of t.from) {
      if (!declared.has(from)) {
        issues.push(blocking({ code: "BAD_ENDPOINT", monitor_id: id, transition_id: t.id, message: `monitor ${id}: transition ${t.id} starts from "${from}", which is not a declared state` }));
      }
    }
    if (!declared.has(t.to)) {
      issues.push(blocking({ code: "BAD_ENDPOINT", monitor_id: id, transition_id: t.id, message: `monitor ${id}: transition ${t.id} goes to "${t.to}", which is not a declared state` }));
    }
    for (const effect of t.effects) {
      if (!allowedEffects.has(effect)) {
        issues.push(
          blocking({
            code: "FORBIDDEN_EFFECT",
            monitor_id: id,
            transition_id: t.id,
            message: `monitor ${id}: transition ${t.id} has effect "${effect}". Monitors may only open review work (${ALLOWED_EFFECTS.join(", ")}); they can never approve, clear, or release`,
          }),
        );
      }
    }
  }
  return issues;
}

/** A monitor must realize what its rule declares for a first evaluation. */
function validateRuleEffects(monitor: Monitor, rule: Rule): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const first = (result: "true" | "indeterminate") =>
    monitor.transitions
      .filter((t) => t.event === "CLAIM_EVALUATED" && t.result_is === result && t.from.includes("UNASSESSED"))
      .sort((a, b) => b.priority - a.priority)[0];
  const mismatch = (transition_id: string | undefined, message: string) =>
    issues.push(blocking({ code: "RULE_EFFECT_MISMATCH", monitor_id: monitor.monitor_id, rule_id: rule.rule_id, transition_id, message: `monitor ${monitor.monitor_id}: ${message}` }));

  const onTrue = first("true");
  if (!onTrue) {
    mismatch(undefined, `no transition handles a true result from UNASSESSED on CLAIM_EVALUATED`);
  } else {
    if (onTrue.to !== "REVIEW_REQUIRED" && onTrue.to !== "ESCALATION_REQUESTED") mismatch(onTrue.id, `a true result must lead to REVIEW_REQUIRED, not ${onTrue.to}`);
    if (!onTrue.effects.includes("OPEN_REVIEW_TASK")) mismatch(onTrue.id, `a true result must open a review task`);
    const escalates = onTrue.effects.includes("REQUEST_ESCALATION");
    if (rule.on_true === "open_review_and_escalate" && !escalates) mismatch(onTrue.id, `rule ${rule.rule_id} requires escalation on true, but transition ${onTrue.id} does not REQUEST_ESCALATION`);
    if (rule.on_true === "open_review" && escalates) mismatch(onTrue.id, `rule ${rule.rule_id} does not call for escalation, but transition ${onTrue.id} requests it`);
  }

  const onInd = first("indeterminate");
  if (onInd) {
    if (rule.on_indeterminate === "open_context_task") {
      if (onInd.to !== "NEEDS_CONTEXT" || !onInd.effects.includes("OPEN_CONTEXT_TASK")) {
        mismatch(onInd.id, `rule ${rule.rule_id} says an indeterminate result opens a context task; transition ${onInd.id} must go to NEEDS_CONTEXT with OPEN_CONTEXT_TASK`);
      }
    } else if (onInd.to !== "REVIEW_REQUIRED" || !onInd.effects.includes("OPEN_REVIEW_TASK")) {
      mismatch(onInd.id, `rule ${rule.rule_id} says an indeterminate result opens review; transition ${onInd.id} must go to REVIEW_REQUIRED with OPEN_REVIEW_TASK`);
    }
  }
  return issues;
}

export function validatePolicy(input: ValidationInput): ValidationReport {
  const issues: ValidationIssue[] = [];
  const enumeration: EnumerationReport[] = [];
  const finish = (): ValidationReport => ({
    ok: !issues.some((i) => i.severity === "blocking"),
    issues,
    enumeration,
    totals: {
      monitors: enumeration.length,
      combinations: enumeration.reduce((n, e) => n + e.combinations, 0),
      deterministic: enumeration.length > 0 && enumeration.every((e) => e.determinism.pass),
      indeterminate_handled: enumeration.length > 0 && enumeration.every((e) => e.indeterminate_handled),
    },
  });

  // 1. Schema.
  const rulesParsed = RulesDocSchema.safeParse(input.rulesDoc);
  const monitorsParsed = MonitorsDocSchema.safeParse(input.monitorsDoc);
  if (!rulesParsed.success) {
    for (const issue of rulesParsed.error.issues) {
      issues.push(blocking({ code: "SCHEMA_INVALID", message: `rules.${formatZodPath(issue.path)}: ${issue.message}` }));
    }
  }
  if (!monitorsParsed.success) {
    for (const issue of monitorsParsed.error.issues) {
      issues.push(blocking({ code: "SCHEMA_INVALID", message: `monitors.${formatZodPath(issue.path)}: ${issue.message}` }));
    }
  }
  if (!rulesParsed.success || !monitorsParsed.success) return finish();
  const rulesDoc = rulesParsed.data;
  const monitors = monitorsParsed.data.monitors;

  // 2. Source coverage.
  if (input.source && input.inventory) {
    issues.push(...validateInventory(input.inventory, input.source.paragraphs));
    issues.push(...validateCoverage(input.inventory, rulesDoc, input.source));
  }

  // 3. Rules and guards.
  const { issues: ruleIssues, compiled } = validateRules(rulesDoc);
  issues.push(...ruleIssues);

  // 4. Monitors.
  for (const dup of duplicates(monitors.map((m) => m.monitor_id))) {
    issues.push(blocking({ code: "DUPLICATE_ID", monitor_id: dup, message: `monitor id ${dup} is used more than once` }));
  }
  const ruleIds = new Set(rulesDoc.rules.map((r) => r.rule_id));
  const monitorsByRule = new Map<string, Monitor[]>();
  for (const monitor of monitors) {
    if (!ruleIds.has(monitor.rule_id)) {
      issues.push(blocking({ code: "MONITOR_RULE_MISMATCH", monitor_id: monitor.monitor_id, rule_id: monitor.rule_id, message: `monitor ${monitor.monitor_id} refers to rule ${monitor.rule_id}, which does not exist` }));
    }
    monitorsByRule.set(monitor.rule_id, [...(monitorsByRule.get(monitor.rule_id) ?? []), monitor]);
  }
  for (const rule of rulesDoc.rules) {
    const count = monitorsByRule.get(rule.rule_id)?.length ?? 0;
    if (count !== 1) {
      issues.push(blocking({ code: "MONITOR_RULE_MISMATCH", rule_id: rule.rule_id, message: `rule ${rule.rule_id} has ${count} monitors; it must have exactly one` }));
    }
  }

  for (const monitor of monitors) {
    const structural = validateMonitorStructure(monitor);
    issues.push(...structural);
    const compiledRule = compiled.get(monitor.rule_id);
    if (!compiledRule) continue; // rule-level blockers already reported; nothing sound to enumerate
    if (structural.some((i) => i.code === "BAD_ENDPOINT")) continue;

    const report = enumerateMonitor(monitor, compiledRule.guard);
    enumeration.push(report);
    for (const cx of report.determinism.counterexamples) {
      const assignment = Object.entries(cx.assignment).map(([k, v]) => `${k}=${v}`).join(", ");
      issues.push(
        blocking({
          code: "NONDETERMINISTIC",
          monitor_id: monitor.monitor_id,
          transition_id: cx.transitions[0],
          counterexample: { state: cx.state, event: cx.event, result: cx.result, assignment: { ...cx.assignment }, transitions: [...cx.transitions] },
          message: `monitor ${monitor.monitor_id}: transitions ${cx.transitions.join(" and ")} both match in ${cx.state} on ${cx.event} when the guard is ${cx.result} (e.g. ${assignment})`,
        }),
      );
    }
    if (!report.indeterminate_handled) {
      issues.push(
        blocking({
          code: "INDETERMINATE_UNHANDLED",
          monitor_id: monitor.monitor_id,
          message: `monitor ${monitor.monitor_id}: nothing handles an indeterminate result from UNASSESSED on CLAIM_EVALUATED. Unknown evidence must never be silently ignored`,
        }),
      );
    }
    for (const state of report.unreachable_states) {
      issues.push(warning({ code: "UNREACHABLE_STATE", monitor_id: monitor.monitor_id, message: `monitor ${monitor.monitor_id}: state ${state} can never be reached` }));
    }
    issues.push(...validateRuleEffects(monitor, compiledRule.rule));
  }

  return finish();
}

/** Rebuilds every rule's guard for runtime use. Call only on a policy that validated. */
export function compileRules(rulesDoc: RulesDoc): Map<string, CompiledRule> {
  const out = new Map<string, CompiledRule>();
  for (const rule of rulesDoc.rules) {
    const built = buildGuardTree(rule.guard);
    if (!built.ok) throw new Error(`rule ${rule.rule_id}: ${built.reason}`);
    out.set(rule.rule_id, { rule, guard: built.tree });
  }
  return out;
}
