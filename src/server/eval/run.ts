/**
 * `pnpm eval` (§18.1–§18.3): runs claim extraction on the Halvorsen case and
 * the edge-case fixtures V1–V8, then scores the resulting findings against the
 * hand-written expectations.
 *
 * Only extraction is under test here. Everything after it is deterministic,
 * and uses the hand-written fallback policy and document facts so a score
 * moves only when extraction does.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { turnHash } from "@/core/deps/hash";
import { type ComparableDocument, type ComparisonResult, type DocFact, compareClaim, isComparable, toPublicMatchFact } from "@/core/evidence/compare";
import { type GroundedClaim, type GroundingResult, type GroundingTurn, groundExtraction } from "@/core/extraction/ground";
import { type LlmExtraction, LlmExtractionSchema, LlmExtractionWireSchema, extractionFromWire } from "@/core/extraction/schema";
import { InventorySchema, MonitorsDocSchema, RulesDocSchema } from "@/core/policy/schema";
import { compileRules } from "@/core/policy/validate";
import { effectiveFields } from "@/core/predicates/evaluate";
import { type ClaimEvaluation, evaluateClaim } from "@/core/runtime/evaluateClaim";
import { parseTranscript } from "@/core/transcript/parse";
import { aggregateMonitorStates, statePath } from "@/core/workflow/finding";
import type { CaseContext, ClaimRecord, ExpertProfile } from "@/core/types";
import { LlmError, llmMode, llmModel, structuredCall } from "../llm/client";
import { EXTRACT_PROMPT_VERSION, EXTRACT_STAGE, EXTRACT_SYSTEM, buildExtractUser } from "../llm/prompts/extract";
import { parseDocumentFile } from "../services/documents";
import type { EvalResult } from "../services/metrics";

const fixture = (...parts: string[]) => resolve(process.cwd(), "fixtures", ...parts);
const readText = (...parts: string[]) => readFileSync(fixture(...parts), "utf8");
const readJson = <T>(...parts: string[]) => JSON.parse(readText(...parts)) as T;

interface ExpectedFinding {
  id?: string;
  turns: string[];
  rules: string[];
  expect_state: string;
  accept_states?: string[];
  escalation?: boolean;
  conflict?: boolean;
  expect_history?: string[];
}
interface Assertion {
  turn: string;
  predicate?: string;
  state?: string;
  field?: string;
  equals?: unknown;
  corrects_turn?: string;
  primary_only?: boolean;
}
interface EvalFixture {
  id: string;
  title: string;
  transcript: string;
  findings: ExpectedFinding[];
  nonFindings: { turns: string[]; why: string }[];
  assertions: Assertion[];
  comparisons: { turn: string; expect: string; reasons?: string[] }[];
}

interface Packet {
  title: string;
  issuer: string;
  ticker: string;
  aliases: string[];
  issuer_fiscal: CaseContext["fiscal"];
  call_date: string;
  research_questions: string[];
}

export function loadEvalFixtures(): EvalFixture[] {
  const gold = readJson<{ findings: ExpectedFinding[]; non_findings: { turns: string[]; why: string }[]; comparisons: { turn: string; expect: string; reasons?: string[] }[] }>("cases", "halvorsen", "gold.json");
  const halvorsen: EvalFixture = { id: "Halvorsen", title: "Halvorsen distributor demand check (§17.6)", transcript: readText("cases", "halvorsen", "transcript-v1.txt"), findings: gold.findings, nonFindings: gold.non_findings, assertions: [], comparisons: gold.comparisons };
  const variants = readdirSync(fixture("cases", "variants"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const v = readJson<{ id: string; title: string; transcript: string; expected: { findings: ExpectedFinding[]; non_findings: { turns: string[]; why: string }[]; assertions: Assertion[] } }>("cases", "variants", f);
      return { id: v.id, title: v.title, transcript: v.transcript, findings: v.expected.findings, nonFindings: v.expected.non_findings, assertions: v.expected.assertions, comparisons: [] };
    });
  return [halvorsen, ...variants];
}

function loadContext(): { ctx: CaseContext; expert: ExpertProfile; packet: Packet; documents: ComparableDocument[] } {
  const packet = readJson<Packet>("cases", "halvorsen", "packet.json");
  const expert = readJson<ExpertProfile>("cases", "halvorsen", "expert.json");
  const goldFacts = readJson<{ documents: Record<string, DocFact[]> }>("documents", "gold-facts.json").documents;
  const documents = readdirSync(fixture("documents"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const doc = parseDocumentFile(file.replace(/\.md$/, ""), readText("documents", file));
      return { id: doc.id, title: doc.title, issuer: doc.issuer, relatedIssuers: doc.relatedIssuers, publishedAt: doc.publishedAt, sourceType: doc.sourceType, facts: goldFacts[doc.id] ?? [] };
    });
  return { ctx: { issuer: packet.issuer, ticker: packet.ticker, aliases: packet.aliases, fiscal: packet.issuer_fiscal, callDate: packet.call_date }, expert, packet, documents };
}

function loadManualPolicy() {
  const raw = readJson<{ inventory: unknown; rules: unknown; unsupported_clauses: unknown; monitors: unknown }>("policy", "manual-monitors-v1.json");
  InventorySchema.parse(raw.inventory);
  const rulesDoc = RulesDocSchema.parse({ rules: raw.rules, unsupported_clauses: raw.unsupported_clauses });
  return { rules: compileRules(rulesDoc), monitors: MonitorsDocSchema.parse({ monitors: raw.monitors }).monitors };
}

interface Evaluated {
  claim: ClaimRecord;
  grounded: GroundedClaim;
  turns: string[];
  primaryTurns: string[];
  comparison: ComparisonResult | null;
  evaluation: ClaimEvaluation;
  state: "REVIEW_REQUIRED" | "NEEDS_CONTEXT" | "NOT_TRIGGERED" | "UNASSESSED";
  hasFinding: boolean;
  triggered: string[];
  needsContext: string[];
  escalation: boolean;
  conflict: boolean;
  history: string[];
}

function evaluateAll(grounding: GroundingResult, env: ReturnType<typeof loadContext>, policy: ReturnType<typeof loadManualPolicy>): Evaluated[] {
  return grounding.claims
    .filter((g) => g.fields.speaker === "expert")
    .map((g) => {
      const claim: ClaimRecord = { logicalKey: g.logicalKey, asserted: g.fields, verified: null, quotes: g.quotes, solicitedByAnalyst: g.solicitedByAnalyst, conflictFields: g.conflictFields, ungroundedFields: g.ungroundedFields };
      const { fields } = effectiveFields(claim);
      const comparison = isComparable(fields, env.ctx) ? compareClaim(fields, env.documents, env.ctx) : null;
      const evaluation = evaluateClaim({ claim, policy, env: { caseContext: env.ctx, expert: env.expert, publicMatch: comparison ? toPublicMatchFact(comparison) : null }, mode: "turn_ordered", eventType: "CLAIM_EVALUATED", eventIdPrefix: `eval:${g.logicalKey}` });
      const conflict = evaluation.monitors.some((m) => m.steps.at(-1)?.conflictFlag);
      const aggregate = aggregateMonitorStates(evaluation.monitors.map((m) => m.finalState));
      const state = conflict ? "REVIEW_REQUIRED" : aggregate;
      const stepCount = evaluation.monitors[0]?.steps.length ?? 0;
      const history = ["UNASSESSED"];
      for (let i = 0; i < stepCount; i++) history.push(aggregateMonitorStates(evaluation.monitors.map((m) => m.steps[i].nextState)));
      return {
        claim,
        grounded: g,
        turns: [...new Set(g.quotes.map((q) => q.turnLabel))],
        primaryTurns: [...new Set(g.quotes.filter((q) => q.role === "primary").map((q) => q.turnLabel))],
        comparison,
        evaluation,
        state,
        hasFinding: state === "REVIEW_REQUIRED" || state === "NEEDS_CONTEXT",
        triggered: evaluation.monitors.filter((m) => m.finalState === "REVIEW_REQUIRED" || m.finalState === "ESCALATION_REQUESTED").map((m) => m.ruleId),
        needsContext: evaluation.monitors.filter((m) => m.finalState === "NEEDS_CONTEXT").map((m) => m.ruleId),
        escalation: evaluation.monitors.some((m) => m.steps.some((s) => s.effects.includes("REQUEST_ESCALATION"))),
        conflict,
        history: statePath(history),
      };
    });
}

type FixtureScore = EvalResult["fixtures"][number];

export function scoreFixture(fx: EvalFixture, grounding: GroundingResult, evaluated: Evaluated[]): Omit<FixtureScore, "status" | "replayed"> {
  const withFinding = evaluated.filter((e) => e.hasFinding);
  const matched = new Set<Evaluated>();
  const missed: string[] = [];
  const stateMismatches: string[] = [];

  for (const expected of fx.findings) {
    const name = `${expected.id ? `${expected.id} ` : ""}${expected.turns.join("+")}`;
    // A finding matches when one claim quotes every expected turn — which is also the cross-turn linking check.
    const hit = withFinding.find((e) => !matched.has(e) && expected.turns.every((t) => e.turns.includes(t)));
    if (!hit) {
      missed.push(`${name} (${expected.rules.join(", ")})`);
      continue;
    }
    matched.add(hit);
    const accepted = expected.accept_states ?? [expected.expect_state];
    if (!accepted.includes(hit.state)) stateMismatches.push(`${name}: expected ${accepted.join(" or ")}, got ${hit.state}`);
    const rules = expected.expect_state === "NEEDS_CONTEXT" ? hit.needsContext : hit.triggered;
    const absent = expected.rules.filter((r) => !rules.includes(r));
    if (absent.length > 0 && accepted.includes(hit.state)) stateMismatches.push(`${name}: rule${absent.length > 1 ? "s" : ""} ${absent.join(", ")} not ${expected.expect_state === "NEEDS_CONTEXT" ? "waiting for context" : "triggered"}`);
    if (expected.escalation && !hit.escalation) stateMismatches.push(`${name}: escalation was not requested`);
    if (expected.conflict && !hit.conflict) stateMismatches.push(`${name}: the conflict was not flagged`);
    if (expected.expect_history && JSON.stringify(hit.history) !== JSON.stringify(expected.expect_history)) stateMismatches.push(`${name}: history ${hit.history.join(" → ")}, expected ${expected.expect_history.join(" → ")}`);
  }
  const extra = withFinding.filter((e) => !matched.has(e)).map((e) => `${e.primaryTurns.join("+") || e.turns.join("+")}: ${e.state} (${[...e.triggered, ...e.needsContext].join(", ") || "conflict"}) — ${e.claim.asserted.summary}`);

  // Assertions about individual predicates and fields (the edge cases V1–V8 exist to test).
  const assertionFailures: string[] = [];
  const onTurn = (a: Assertion) => {
    const primary = evaluated.filter((e) => e.primaryTurns.includes(a.turn));
    return a.primary_only || primary.length > 0 ? primary : evaluated.filter((e) => e.turns.includes(a.turn));
  };
  for (const a of fx.assertions) {
    const candidates = onTurn(a);
    if (candidates.length === 0) {
      assertionFailures.push(`${a.turn}: no claim was extracted from this turn`);
      continue;
    }
    if (a.predicate) {
      const states = candidates.map((c) => {
        const key = Object.keys(c.evaluation.finalAssessments).find((k) => k === a.predicate || k.startsWith(`${a.predicate}(`));
        return key ? c.evaluation.finalAssessments[key].state : "not evaluated";
      });
      if (!states.includes(a.state as never)) assertionFailures.push(`${a.turn}: ${a.predicate} expected ${a.state}, got ${[...new Set(states)].join(" / ")}`);
    }
    if (a.field) {
      const values = candidates.map((c) => a.field!.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | null)?.[k], effectiveFields(c.claim).fields));
      if (!values.includes(a.equals)) assertionFailures.push(`${a.turn}: ${a.field} expected ${JSON.stringify(a.equals)}, got ${[...new Set(values.map((v) => JSON.stringify(v)))].join(" / ")}`);
    }
    if (a.corrects_turn) {
      const ok = candidates.some((c) => {
        const target = evaluated.find((e) => e.claim.logicalKey === c.claim.asserted.is_correction_of);
        return target?.turns.includes(a.corrects_turn!);
      });
      if (!ok) assertionFailures.push(`${a.turn}: not linked as a correction of the claim on ${a.corrects_turn}`);
    }
  }
  // A turn the fixture says is harmless must not carry a finding of its own.
  for (const n of fx.nonFindings) {
    const offending = withFinding.filter((e) => !matched.has(e) && n.turns.some((t) => e.primaryTurns.includes(t)));
    if (offending.length > 0 && !extra.some((x) => x.startsWith(`${n.turns[0]}`))) extra.push(`${n.turns.join("+")}: unexpected finding (${n.why})`);
  }

  const comparisons = fx.comparisons.map((c) => {
    const claim = evaluated.find((e) => e.turns.includes(c.turn) && e.comparison);
    const actual = claim?.comparison ? `${claim.comparison.outcome}${claim.comparison.reasons.length ? ` [${claim.comparison.reasons.join(", ")}]` : ""}` : null;
    const expected = `${c.expect}${c.reasons?.length ? ` [${c.reasons.join(", ")}]` : ""}`;
    return { turn: c.turn, expected, actual, ok: actual === expected };
  });

  const expectedCount = fx.findings.length;
  return {
    id: fx.id,
    title: fx.title,
    expectedFindings: expectedCount,
    matchedFindings: matched.size,
    extraFindings: extra.length,
    recall: expectedCount > 0 ? matched.size / expectedCount : null,
    precision: matched.size + extra.length > 0 ? matched.size / (matched.size + extra.length) : null,
    missed,
    extra,
    stateMismatches,
    assertionsPassed: fx.assertions.length - assertionFailures.length,
    assertionsTotal: fx.assertions.length,
    assertionFailures,
    comparisons: comparisons.length > 0 ? comparisons : undefined,
    quotes: { proposed: grounding.stats.proposedQuotes, valid: grounding.stats.validQuotes },
    claims: grounding.claims.length,
  };
}

async function extract(fx: EvalFixture, env: ReturnType<typeof loadContext>, turns: (GroundingTurn & { speakerName: string })[]): Promise<{ extraction: LlmExtraction; replayed: boolean }> {
  const result = await structuredCall({
    stage: EXTRACT_STAGE,
    promptVersion: EXTRACT_PROMPT_VERSION,
    schema: LlmExtractionWireSchema,
    system: EXTRACT_SYSTEM,
    user: buildExtractUser({ ctx: env.ctx, researchQuestions: env.packet.research_questions, expert: env.expert, turns: turns.map((t) => ({ label: t.label, speaker: t.speaker, text: t.text })) }),
    effort: "high",
    maxTokens: 32000,
    ref: { eval: fx.id },
  });
  return { extraction: LlmExtractionSchema.parse(extractionFromWire(result.data)), replayed: result.replayed };
}

export async function runEval(options: { only?: string[]; onFixture?: (score: FixtureScore) => void } = {}): Promise<EvalResult> {
  const env = loadContext();
  const policy = loadManualPolicy();
  const fixtures = loadEvalFixtures().filter((f) => !options.only || options.only.includes(f.id));
  const result: EvalResult = { mode: llmMode(), model: llmModel(), generatedAt: new Date().toISOString(), fixtures: [] };

  for (const fx of fixtures) {
    let score: FixtureScore;
    try {
      const turns = parseTranscript(fx.transcript, { filename: `${fx.id}.txt` }).turns.map((t) => ({ label: t.label, idx: t.idx, speaker: t.speaker, speakerName: t.speakerName, text: t.text, textHash: turnHash(t.text) }));
      const { extraction, replayed } = await extract(fx, env, turns);
      const grounding = groundExtraction(extraction, turns);
      score = { ...scoreFixture(fx, grounding, evaluateAll(grounding, env, policy)), status: "scored", replayed };
    } catch (err) {
      if (!(err instanceof LlmError) && !(err instanceof Error)) throw err;
      // A fixture that could not run is reported as such; it is never scored as a pass.
      score = { id: fx.id, title: fx.title, status: "error", error: err.message, expectedFindings: fx.findings.length, matchedFindings: 0, extraFindings: 0, recall: null, precision: null, missed: fx.findings.map((f) => f.turns.join("+")), extra: [], stateMismatches: [], assertionsPassed: 0, assertionsTotal: fx.assertions.length, assertionFailures: [], quotes: { proposed: 0, valid: 0 }, claims: 0 };
    }
    result.fixtures.push(score);
    options.onFixture?.(score);
  }
  return result;
}
