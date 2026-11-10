/**
 * Zod schemas for compiled policy artifacts: inventory, rules, guard trees,
 * and monitors (§7.2, §8.2–§8.4).
 *
 * Guards are data, never code (decision D7): a JSON expression tree over the
 * fixed predicate registry. There is no string guard form, so nothing a model
 * or a policy author writes is ever evaluated as a program.
 *
 * Two families of schema live here:
 *  - canonical schemas (`RuleSchema`, `MonitorSchema`, …) validate what is
 *    stored and what the validator checks. Vocabulary membership (predicate
 *    names, effects, state names) is left as `string` on purpose so the
 *    validator can report a precise code such as UNKNOWN_PREDICATE or
 *    FORBIDDEN_EFFECT instead of a generic schema error.
 *  - `Llm*` schemas are what the model is asked to emit. Structured outputs
 *    cannot express recursion, records, or numeric bounds, so guards are a
 *    flat node list and params are key/value pairs.
 */
import { z } from "zod";
import type { PredicateParams } from "../predicates/registry";
import { predicateKey } from "../predicates/registry";

// ── Vocabulary ──────────────────────────────────────────────────────────────

export const MONITOR_STATES = ["UNASSESSED", "NEEDS_CONTEXT", "REVIEW_REQUIRED", "ESCALATION_REQUESTED", "NOT_TRIGGERED"] as const;
export type MonitorState = (typeof MONITOR_STATES)[number];

export const MONITOR_EVENTS = ["CLAIM_EVALUATED", "CONTEXT_UPDATED"] as const;
export type MonitorEventType = (typeof MONITOR_EVENTS)[number];

/**
 * Monitor effects describe review work only. The vocabulary has no "cleared",
 * "approved", or "released": those exist only in the fixed workflow (§8.4).
 */
export const ALLOWED_EFFECTS = ["OPEN_REVIEW_TASK", "OPEN_CONTEXT_TASK", "REQUEST_ESCALATION", "CLOSE_CONTEXT_TASK", "AUDIT_ONLY"] as const;
export type Effect = (typeof ALLOWED_EFFECTS)[number];

export const CLAUSE_KINDS = ["duty", "prohibition", "exception", "escalation", "evidence_requirement", "discretion", "definition", "out_of_scope"] as const;
export type ClauseKind = (typeof CLAUSE_KINDS)[number];
/** Clause kinds that must end up in a rule or be explicitly listed as unsupported (§8.3). */
export const ACTIONABLE_CLAUSE_KINDS: readonly ClauseKind[] = ["duty", "prohibition", "exception", "escalation"];

export const MAX_GUARD_DEPTH = 4;
export const MAX_GUARD_ARGS = 6;
export const MAX_PREDICATES_PER_GUARD = 8;

// ── Inventory (§8.2) ────────────────────────────────────────────────────────

export const ClauseSchema = z.strictObject({
  clause_id: z.string(), // "C1", "C2", …
  paragraph: z.string(), // "P3"
  verbatim: z.string(), // exact text; the server locates it
  kind: z.enum(CLAUSE_KINDS),
  plain_meaning: z.string(),
  cross_refs: z.array(z.string()),
  ambiguity: z.string().nullable(),
});
export type Clause = z.infer<typeof ClauseSchema>;

export const InventorySchema = z.strictObject({ clauses: z.array(ClauseSchema) });
export type Inventory = z.infer<typeof InventorySchema>;

// ── Guards (§7.2) ───────────────────────────────────────────────────────────

export type GuardExpr =
  | { op: "pred"; name: string; params?: PredicateParams }
  | { op: "and"; args: GuardExpr[] }
  | { op: "or"; args: GuardExpr[] }
  | { op: "not"; arg: GuardExpr };

export const FlatGuardNodeSchema = z.strictObject({
  id: z.string().min(1),
  op: z.enum(["pred", "and", "or", "not"]),
  name: z.string().optional(),
  params: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  children: z.array(z.string()).optional(),
});
export type FlatGuardNode = z.infer<typeof FlatGuardNodeSchema>;

export const FlatGuardSchema = z.strictObject({
  root: z.string().min(1),
  nodes: z.array(FlatGuardNodeSchema).min(1),
});
export type FlatGuard = z.infer<typeof FlatGuardSchema>;

export type GuardBuildResult = { ok: true; tree: GuardExpr } | { ok: false; reason: string };

/** Rebuilds the tree from the flat form; rejects cycles, dangling ids, bad arity, and depth > 4. */
export function buildGuardTree(flat: FlatGuard): GuardBuildResult {
  const byId = new Map<string, FlatGuardNode>();
  for (const node of flat.nodes) {
    if (byId.has(node.id)) return { ok: false, reason: `duplicate guard node id "${node.id}"` };
    byId.set(node.id, node);
  }
  if (!byId.has(flat.root)) return { ok: false, reason: `root "${flat.root}" is not a node` };

  const visiting = new Set<string>();
  const used = new Set<string>();

  const build = (id: string, depth: number): GuardBuildResult => {
    const node = byId.get(id);
    if (!node) return { ok: false, reason: `node "${id}" is referenced but not defined` };
    if (visiting.has(id)) return { ok: false, reason: `cycle through node "${id}"` };
    if (depth > MAX_GUARD_DEPTH) return { ok: false, reason: `guard is deeper than ${MAX_GUARD_DEPTH} levels at node "${id}"` };
    used.add(id);
    const children = node.children ?? [];

    if (node.op === "pred") {
      if (!node.name) return { ok: false, reason: `pred node "${id}" has no predicate name` };
      if (children.length > 0) return { ok: false, reason: `pred node "${id}" must not have children` };
      const params = node.params && Object.keys(node.params).length > 0 ? node.params : undefined;
      return { ok: true, tree: params ? { op: "pred", name: node.name, params } : { op: "pred", name: node.name } };
    }
    if (node.name) return { ok: false, reason: `${node.op} node "${id}" must not name a predicate` };

    visiting.add(id);
    const built: GuardExpr[] = [];
    for (const childId of children) {
      const child = build(childId, depth + 1);
      if (!child.ok) return child;
      built.push(child.tree);
    }
    visiting.delete(id);

    if (node.op === "not") {
      if (built.length !== 1) return { ok: false, reason: `not node "${id}" needs exactly 1 child (has ${built.length})` };
      return { ok: true, tree: { op: "not", arg: built[0] } };
    }
    if (built.length < 2 || built.length > MAX_GUARD_ARGS) {
      return { ok: false, reason: `${node.op} node "${id}" needs 2–${MAX_GUARD_ARGS} children (has ${built.length})` };
    }
    return { ok: true, tree: { op: node.op, args: built } };
  };

  const result = build(flat.root, 1);
  if (!result.ok) return result;
  const orphans = flat.nodes.filter((n) => !used.has(n.id)).map((n) => n.id);
  if (orphans.length > 0) return { ok: false, reason: `nodes not reachable from the root: ${orphans.join(", ")}` };
  return result;
}

/** Flattens a tree back to the stored form with ids n1, n2, … in pre-order. */
export function flattenGuard(tree: GuardExpr): FlatGuard {
  const nodes: FlatGuardNode[] = [];
  let counter = 0;
  const walk = (expr: GuardExpr): string => {
    const id = `n${++counter}`;
    if (expr.op === "pred") {
      nodes.push(expr.params ? { id, op: "pred", name: expr.name, params: expr.params } : { id, op: "pred", name: expr.name });
      return id;
    }
    const node: FlatGuardNode = { id, op: expr.op, children: [] };
    nodes.push(node);
    node.children = expr.op === "not" ? [walk(expr.arg)] : expr.args.map(walk);
    return id;
  };
  const root = walk(tree);
  return { root, nodes };
}

export interface PredicateUseInGuard {
  key: string;
  name: string;
  params: PredicateParams;
}

/** Distinct predicate uses in a guard, in first-appearance order. */
export function collectPredicates(tree: GuardExpr): PredicateUseInGuard[] {
  const out = new Map<string, PredicateUseInGuard>();
  const walk = (expr: GuardExpr): void => {
    if (expr.op === "pred") {
      const key = predicateKey(expr.name, expr.params);
      if (!out.has(key)) out.set(key, { key, name: expr.name, params: expr.params ?? {} });
    } else if (expr.op === "not") {
      walk(expr.arg);
    } else {
      expr.args.forEach(walk);
    }
  };
  walk(tree);
  return [...out.values()];
}

// ── Rules (§8.3) ────────────────────────────────────────────────────────────

export const RuleSchema = z.strictObject({
  rule_id: z.string().min(1), // "R1"
  source_clause_ids: z.array(z.string()),
  intent: z.string(),
  guard: FlatGuardSchema, // an object, never a string: no code can be smuggled in as a guard
  on_true: z.enum(["open_review", "open_review_and_escalate"]),
  on_indeterminate: z.enum(["open_context_task", "open_review"]),
  severity: z.enum(["high", "medium", "low"]),
  exception_clause_ids: z.array(z.string()), // exceptions folded into the guard as not(...)
});
export type Rule = z.infer<typeof RuleSchema>;

export const UnsupportedClauseSchema = z.strictObject({ clause_id: z.string(), reason: z.string() });
export type UnsupportedClause = z.infer<typeof UnsupportedClauseSchema>;

export const RulesDocSchema = z.strictObject({
  rules: z.array(RuleSchema),
  unsupported_clauses: z.array(UnsupportedClauseSchema),
});
export type RulesDoc = z.infer<typeof RulesDocSchema>;

// ── Monitors (§8.4) ─────────────────────────────────────────────────────────

export const TransitionSchema = z.strictObject({
  id: z.string().min(1),
  from: z.array(z.string()),
  event: z.enum(MONITOR_EVENTS),
  guard_ref: z.literal("rule"), // the rule's guard; monitors cannot define new guards
  result_is: z.enum(["true", "false", "indeterminate"]),
  to: z.string(),
  effects: z.array(z.string()),
  priority: z.number().int(),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const MonitorSchema = z.strictObject({
  monitor_id: z.string().min(1),
  rule_id: z.string().min(1),
  scope: z.literal("claim"),
  initial_state: z.literal("UNASSESSED"),
  states: z.array(z.string()),
  transitions: z.array(TransitionSchema),
  default_event_behavior: z.literal("NO_STATE_CHANGE_AND_AUDIT"),
});
export type Monitor = z.infer<typeof MonitorSchema>;

export const MonitorsDocSchema = z.strictObject({ monitors: z.array(MonitorSchema) });
export type MonitorsDoc = z.infer<typeof MonitorsDocSchema>;

// ── Model-facing schemas (structured outputs) ───────────────────────────────

export const LlmInventorySchema = z.object({
  clauses: z.array(
    z.object({
      clause_id: z.string(),
      paragraph: z.string(),
      verbatim: z.string(),
      kind: z.enum(CLAUSE_KINDS),
      plain_meaning: z.string(),
      cross_refs: z.array(z.string()),
      ambiguity: z.string().nullable(),
    }),
  ),
});

export const LlmFlatGuardSchema = z.object({
  root: z.string(),
  nodes: z.array(
    z.object({
      id: z.string(),
      op: z.enum(["pred", "and", "or", "not"]),
      name: z.string().nullable(), // predicate name when op = pred
      params: z.array(z.object({ key: z.string(), value: z.union([z.number(), z.string()]) })),
      children: z.array(z.string()), // child node ids when op = and | or | not
    }),
  ),
});
export type LlmFlatGuard = z.infer<typeof LlmFlatGuardSchema>;

export const LlmRulesSchema = z.object({
  rules: z.array(
    z.object({
      rule_id: z.string(),
      source_clause_ids: z.array(z.string()),
      intent: z.string(),
      guard: LlmFlatGuardSchema,
      on_true: z.enum(["open_review", "open_review_and_escalate"]),
      on_indeterminate: z.enum(["open_context_task", "open_review"]),
      severity: z.enum(["high", "medium", "low"]),
      exception_clause_ids: z.array(z.string()),
    }),
  ),
  unsupported_clauses: z.array(z.object({ clause_id: z.string(), reason: z.string() })),
});
export type LlmRules = z.infer<typeof LlmRulesSchema>;

export const LlmMonitorsSchema = z.object({
  monitors: z.array(
    z.object({
      monitor_id: z.string(),
      rule_id: z.string(),
      scope: z.literal("claim"),
      initial_state: z.literal("UNASSESSED"),
      states: z.array(z.enum(MONITOR_STATES)),
      transitions: z.array(
        z.object({
          id: z.string(),
          from: z.array(z.string()),
          event: z.enum(MONITOR_EVENTS),
          guard_ref: z.literal("rule"),
          result_is: z.enum(["true", "false", "indeterminate"]),
          to: z.string(),
          effects: z.array(z.enum(ALLOWED_EFFECTS)),
          priority: z.number().int(),
        }),
      ),
      default_event_behavior: z.literal("NO_STATE_CHANGE_AND_AUDIT"),
    }),
  ),
});
export type LlmMonitors = z.infer<typeof LlmMonitorsSchema>;

/** Converts a model-emitted guard (params as pairs, nulls for absent members) to the canonical flat form. */
export function llmGuardToFlat(guard: LlmFlatGuard): FlatGuard {
  return {
    root: guard.root,
    nodes: guard.nodes.map((n) => {
      const node: FlatGuardNode = { id: n.id, op: n.op };
      if (n.name !== null && n.name !== "") node.name = n.name;
      if (n.params.length > 0) node.params = Object.fromEntries(n.params.map((p) => [p.key, p.value]));
      if (n.children.length > 0) node.children = n.children;
      return node;
    }),
  };
}

export function llmRulesToDoc(rules: LlmRules): RulesDoc {
  return {
    rules: rules.rules.map((r) => ({ ...r, guard: llmGuardToFlat(r.guard) })),
    unsupported_clauses: rules.unsupported_clauses,
  };
}

// ── Policy source paragraphs ────────────────────────────────────────────────

export interface PolicyParagraph {
  id: string; // "P3"
  text: string; // without the [P3] marker
  start: number; // offset of `text` in the source
  end: number;
}

/**
 * Splits policy text into paragraphs. Text that already carries `[P1]`
 * markers keeps them; otherwise non-heading paragraphs are numbered in order.
 */
export function parsePolicyParagraphs(source: string): PolicyParagraph[] {
  const text = source.replace(/\r\n?/g, "\n");
  const marker = /^\[(P\d+)\][ \t]*/gm;
  const marks = [...text.matchAll(marker)];
  if (marks.length > 0) {
    return marks.map((m, i) => {
      const start = m.index + m[0].length;
      const rawEnd = i + 1 < marks.length ? marks[i + 1].index : text.length;
      const body = text.slice(start, rawEnd).replace(/\s+$/, "");
      return { id: m[1], text: body, start, end: start + body.length };
    });
  }
  const out: PolicyParagraph[] = [];
  const block = /[^\n]+(?:\n[^\n]+)*/g;
  let n = 0;
  for (const m of text.matchAll(block)) {
    const body = m[0].trim();
    if (!body || body.startsWith("#")) continue;
    const start = m.index + m[0].indexOf(body);
    out.push({ id: `P${++n}`, text: body, start, end: start + body.length });
  }
  return out;
}

/** The policy as sent to the model: every paragraph prefixed with its id. */
export function renderParagraphsForPrompt(paragraphs: PolicyParagraph[]): string {
  return paragraphs.map((p) => `[${p.id}] ${p.text}`).join("\n\n");
}
