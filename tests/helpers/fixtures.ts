/** Loads fixtures for tests. No network, no database. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { turnHash } from "@/core/deps/hash";
import { type ComparableDocument, type DocFact, compareClaim, isComparable, toPublicMatchFact } from "@/core/evidence/compare";
import { type GroundedClaim, type GroundingTurn, groundExtraction } from "@/core/extraction/ground";
import { LlmExtractionSchema } from "@/core/extraction/schema";
import { type Scenario, ScenarioFileSchema } from "@/core/policy/scenarios";
import { type Inventory, InventorySchema, type Monitor, MonitorsDocSchema, type PolicyParagraph, type RulesDoc, RulesDocSchema, parsePolicyParagraphs } from "@/core/policy/schema";
import { type CompiledRule, compileRules } from "@/core/policy/validate";
import { effectiveFields } from "@/core/predicates/evaluate";
import type { PublicMatchFact } from "@/core/predicates/registry";
import { evaluateClaim } from "@/core/runtime/evaluateClaim";
import { parseTranscript } from "@/core/transcript/parse";
import { aggregateMonitorStates } from "@/core/workflow/finding";
import type { CaseContext, ClaimRecord, ExpertProfile } from "@/core/types";

const ROOT = join(__dirname, "..", "..", "fixtures");
export const fixturePath = (...parts: string[]) => join(ROOT, ...parts);
export const readFixture = (...parts: string[]) => readFileSync(fixturePath(...parts), "utf8");
export const readJson = <T = unknown>(...parts: string[]) => JSON.parse(readFixture(...parts)) as T;

export interface ManualPolicy {
  sourceText: string;
  paragraphs: PolicyParagraph[];
  requiredParagraphs: string[];
  inventory: Inventory;
  rulesDoc: RulesDoc;
  monitors: Monitor[];
  rules: Map<string, CompiledRule>;
}

export const REQUIRED_PARAGRAPHS = ["P2", "P3", "P4", "P5"];

export function loadManualPolicy(): ManualPolicy {
  const sourceText = readFixture("policy", "blink-demo-policy-v1.md");
  const raw = readJson<Record<string, unknown>>("policy", "manual-monitors-v1.json");
  const inventory = InventorySchema.parse(raw.inventory);
  const rulesDoc = RulesDocSchema.parse({ rules: raw.rules, unsupported_clauses: raw.unsupported_clauses });
  const monitors = MonitorsDocSchema.parse({ monitors: raw.monitors }).monitors;
  return { sourceText, paragraphs: parsePolicyParagraphs(sourceText), requiredParagraphs: REQUIRED_PARAGRAPHS, inventory, rulesDoc, monitors, rules: compileRules(rulesDoc) };
}

export function loadScenarios(): Scenario[] {
  return ScenarioFileSchema.parse(readJson("policy", "scenarios-v1.json")).scenarios;
}

interface PacketFile {
  title: string;
  issuer: string;
  ticker: string;
  aliases: string[];
  issuer_fiscal: CaseContext["fiscal"];
  call_date: string;
  research_questions: string[];
  analyst_notes: string;
}

export function loadHalvorsenContext(): { ctx: CaseContext; expert: ExpertProfile; packet: PacketFile } {
  const packet = readJson<PacketFile>("cases", "halvorsen", "packet.json");
  const expert = readJson<ExpertProfile>("cases", "halvorsen", "expert.json");
  return { ctx: { issuer: packet.issuer, ticker: packet.ticker, aliases: packet.aliases, fiscal: packet.issuer_fiscal, callDate: packet.call_date }, expert, packet };
}

export function loadGoldDocuments(): ComparableDocument[] {
  const gold = readJson<{ documents: Record<string, DocFact[]> }>("documents", "gold-facts.json").documents;
  return readdirSync(fixturePath("documents"))
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const text = readFixture("documents", file);
      const front = /^---\n([\s\S]*?)\n---/.exec(text)![1];
      const meta: Record<string, string> = {};
      for (const line of front.split("\n")) {
        const i = line.indexOf(":");
        meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      const id = file.replace(/\.md$/, "");
      const related = meta.related_issuers ? meta.related_issuers.replace(/^\[|\]$/g, "").split(",").map((s) => s.trim()).filter(Boolean) : [];
      return { id, title: meta.title, issuer: meta.issuer, relatedIssuers: related, publishedAt: meta.published_at, sourceType: meta.source_type, facts: gold[id] ?? [] };
    });
}

export function turnsOf(transcript: string): GroundingTurn[] {
  return parseTranscript(transcript, { filename: "t.txt" }).turns.map((t) => ({ label: t.label, idx: t.idx, speaker: t.speaker, text: t.text, textHash: turnHash(t.text) }));
}

export function toClaimRecord(c: GroundedClaim): ClaimRecord {
  return { logicalKey: c.logicalKey, asserted: c.fields, verified: null, quotes: c.quotes, solicitedByAnalyst: c.solicitedByAnalyst, conflictFields: c.conflictFields, ungroundedFields: c.ungroundedFields };
}

export interface EvaluatedFixtureClaim {
  claim: ClaimRecord;
  turns: string[];
  comparison: ReturnType<typeof compareClaim> | null;
  publicMatch: PublicMatchFact | null;
  evaluation: ReturnType<typeof evaluateClaim>;
  aggregate: ReturnType<typeof aggregateMonitorStates>;
  /** Rules whose monitor ended in REVIEW_REQUIRED. */
  triggered: string[];
  needsContext: string[];
  escalation: boolean;
  conflict: boolean;
}

/** The whole deterministic pipeline for one fixture: ground → compare → evaluate, with no database. */
export function evaluateFixture(extractionRaw: unknown, transcript: string, policy = loadManualPolicy()) {
  const { ctx, expert } = loadHalvorsenContext();
  const documents = loadGoldDocuments();
  const turns = turnsOf(transcript);
  const grounding = groundExtraction(LlmExtractionSchema.parse(extractionRaw), turns);
  const claims: EvaluatedFixtureClaim[] = grounding.claims
    .filter((c) => c.fields.speaker === "expert")
    .map((g) => {
      const claim = toClaimRecord(g);
      const { fields } = effectiveFields(claim);
      const comparison = isComparable(fields, ctx) ? compareClaim(fields, documents, ctx) : null;
      const publicMatch = comparison ? toPublicMatchFact(comparison) : null;
      const evaluation = evaluateClaim({ claim, policy, env: { caseContext: ctx, expert, publicMatch }, mode: "turn_ordered", eventType: "CLAIM_EVALUATED", eventIdPrefix: `test:${claim.logicalKey}` });
      const finals = evaluation.monitors.map((m) => m.finalState);
      return {
        claim,
        turns: [...new Set(claim.quotes.map((q) => q.turnLabel))],
        comparison,
        publicMatch,
        evaluation,
        aggregate: aggregateMonitorStates(finals),
        triggered: evaluation.monitors.filter((m) => m.finalState === "REVIEW_REQUIRED" || m.finalState === "ESCALATION_REQUESTED").map((m) => m.ruleId),
        needsContext: evaluation.monitors.filter((m) => m.finalState === "NEEDS_CONTEXT").map((m) => m.ruleId),
        escalation: evaluation.monitors.some((m) => m.steps.some((s) => s.effects.includes("REQUEST_ESCALATION"))),
        conflict: evaluation.monitors.some((m) => m.steps.at(-1)?.conflictFlag),
      };
    });
  return { grounding, claims, ctx, expert, documents, turns };
}

export interface VariantFixture {
  id: string;
  title: string;
  tests: string;
  transcript: string;
  expected: {
    findings: { turns: string[]; rules: string[]; expect_state: string; accept_states?: string[]; escalation?: boolean; conflict?: boolean }[];
    non_findings: { turns: string[]; why: string }[];
    assertions: Record<string, unknown>[];
  };
  extraction: unknown;
}

export function loadVariants(): VariantFixture[] {
  return readdirSync(fixturePath("cases", "variants"))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => readJson<VariantFixture>("cases", "variants", f));
}
