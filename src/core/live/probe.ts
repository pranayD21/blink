/**
 * The question probe: would the fact a question asks for, if the expert gave it, already sit
 * inside a rule's topic? Only the topic predicates are judged; what the expert would say about
 * source or timing is not known yet, so those stay unknown and cannot rule a rule out. Pure.
 */
import type { LlmQuestionWire } from "../extraction/schema";
import { collectPredicates } from "../policy/schema";
import { type EvaluationEnv, assessClaim, fullScope, statesOf } from "../predicates/evaluate";
import { getPredicate } from "../predicates/registry";
import { type CompiledPolicy } from "../runtime/evaluateClaim";
import { evaluateGuard } from "../runtime/monitorReducer";
import type { CaseContext, ClaimFields, ClaimRecord, EvidenceField } from "../types";

const TOPIC_FIELDS: ReadonlySet<EvidenceField> = new Set<EvidenceField>(["subject_entity", "metric", "event_kind", "period", "scope"]);

/** A predicate that reads only what a question can name: who, what, when and how widely. */
export function isTopicPredicate(name: string): boolean {
  const def = getPredicate(name);
  return !!def && def.inputs.length > 0 && def.inputs.every((f) => TOPIC_FIELDS.has(f));
}

/** The claim a question would produce if answered, or null when it asks for no fact. */
export function probeClaim(question: LlmQuestionWire, turnLabel: string, ctx: CaseContext): ClaimRecord | null {
  if (!question.asks_for_fact) return null;
  const name = question.subject_kind === "issuer" && question.subject_name.trim() === "" ? ctx.issuer : question.subject_name;
  const asserted: ClaimFields = {
    summary: "",
    speaker: "analyst",
    subject_entity: { name, kind: question.subject_kind },
    metric: question.metric_category === "none" ? null : { category: question.metric_category, label: question.metric_category.replaceAll("_", " ") },
    event_kind: question.event_kind,
    period: { label: null, fiscal_year: null, fiscal_quarter: null, calendar_year: null, calendar_quarter: null, relative: question.period_relative },
    value: null,
    scope: question.scope,
    scope_detail: null,
    knowledge_basis: "unstated",
    access_timing: "unknown",
    confidentiality_signals: [],
    qualifications: [],
    is_correction_of: null,
  };
  return { logicalKey: `probe:${turnLabel}`, asserted, verified: null, quotes: [], solicitedByAnalyst: "yes", conflictFields: [], ungroundedFields: [] };
}

/** Rules whose topic the question asks about: every topic predicate supported, and the guard not already false. */
export function probeRuleIds(question: LlmQuestionWire, turnLabel: string, env: EvaluationEnv, policy: CompiledPolicy): string[] {
  const claim = probeClaim(question, turnLabel, env.caseContext);
  if (!claim) return [];
  const hits: string[] = [];
  for (const [ruleId, rule] of policy.rules) {
    const uses = collectPredicates(rule.guard);
    const topics = uses.filter((u) => isTopicPredicate(u.name));
    if (topics.length === 0) continue;
    const states = statesOf(assessClaim(uses, claim, env, fullScope(claim)));
    if (!topics.every((u) => states[u.key] === "supported")) continue;
    if (evaluateGuard(rule.guard, states).tri === "false") continue;
    hits.push(ruleId);
  }
  return hits;
}
