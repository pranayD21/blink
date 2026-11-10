/**
 * Real published firm policies (spec section 11, Task 36).
 *
 * Each policy is an excerpt of a code of ethics filed on EDGAR, kept verbatim
 * in `fixtures/real/policies/<name>.md`. `pnpm eval:policies` compiles each one
 * with Blink's own compiler and writes what came out to
 * `fixtures/real/policies/<name>.compiled.json`. `loadRealPolicy` reads that
 * bundle, so a real call can be evaluated under the policy without a database
 * or a model call. A policy that did not validate is never loaded.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { sha256Hex } from "@/core/deps/hash";
import { type Inventory, type Monitor, MonitorsDocSchema, type RulesDoc, RulesDocSchema } from "@/core/policy/schema";
import { type ValidationIssue, compileRules } from "@/core/policy/validate";
import type { CompiledPolicy } from "@/core/runtime/evaluateClaim";
import { findingCleared } from "@/core/workflow/brief";
import { aggregateMonitorStates } from "@/core/workflow/finding";
import { loadActor } from "../auth/actor";
import { getDb, transact } from "../db/client";
import { cases, llmCalls, monitorInstances } from "../db/schema";
import { drainJobs } from "../jobs/runner";
import { costUsd } from "../llm/client";
import { latestRun } from "../services/analysis";
import { eligibilityForCase } from "../services/briefs";
import { CreateCaseSchema, createCase } from "../services/cases";
import { createPolicy, finalizeCompile, loadManualFallback } from "../services/policies";
import { loadCurrentClaims } from "../services/loaders";
import { fixturePolicyInput, seedUsersOnly } from "../services/seed";
import { uploadTranscript } from "../services/transcripts";

export interface RealPolicy {
  name: string;
  /**
   * Paragraphs marked "must be automated". The rule, chosen before any compile ran: a paragraph is required
   * when it states a duty or prohibition that something said to the firm's people in a conversation can
   * trigger. That is soliciting or receiving inside, material non-public or confidential information;
   * reporting that such information may have been received; or a limit on which experts may be consulted
   * because of who they are. Duties about trading, passing information on, firm administration, call
   * logistics and scripts, and definitions are not marked.
   */
  requiredParagraphs: string[];
}

export const REAL_POLICIES: readonly RealPolicy[] = [
  // P4 report receipt of MNPI; P9 consultations likely to disclose MNPI prohibited; P11 report a disclosure of
  // confidential information; P21 no soliciting it; P22 report inadvertent receipt; P23-P26 restricted experts.
  { name: "oaktree", requiredParagraphs: ["P4", "P9", "P11", "P21", "P22", "P23", "P24", "P25", "P26"] },
  // P8 and P26 notify the CCO of possible MNPI; P11 the same for public-company contacts; P18-P21 experts who
  // may not be approved (bound by an agreement, recent employees, government officials, clinical-trial doctors).
  { name: "sage-rock", requiredParagraphs: ["P8", "P11", "P18", "P19", "P20", "P21", "P26"] },
  // P2 and P8 contact Legal or the Administrator on possible MNPI; P7 do not knowingly accept MNPI; P17 consult
  // Legal on recent-employee consultants; P21 public-company contacts; P23-P24 value-added investors.
  { name: "tcw", requiredParagraphs: ["P2", "P7", "P8", "P17", "P21", "P23", "P24"] },
];

/** What `pnpm eval:policies` wrote for one policy. Ids that differ from run to run are left out. */
export interface RealPolicyBundle {
  name: string;
  title: string;
  sourceTextHash: string;
  requiredParagraphs: string[];
  status: "VALIDATED" | "COMPILE_FAILED";
  bundleHash: string | null;
  attempts: { stage: string; attemptNo: number; issues: string[] }[];
  compileError: { code: string; message: string } | null;
  issues: ValidationIssue[];
  inventory: Inventory | null;
  rulesDoc: RulesDoc | null;
  monitors: Monitor[];
}

const dir = () => resolve(process.cwd(), "fixtures", "real", "policies");
export const realPolicyPath = (name: string) => resolve(dir(), `${name}.md`);
export const realPolicyBundlePath = (name: string) => resolve(dir(), `${name}.compiled.json`);

function known(name: string): RealPolicy {
  const policy = REAL_POLICIES.find((p) => p.name === name);
  if (!policy) throw new Error(`unknown real policy "${name}"; the real policies are ${REAL_POLICIES.map((p) => p.name).join(", ")}`);
  return policy;
}

export function realPolicyText(name: string): string {
  known(name);
  return readFileSync(realPolicyPath(name), "utf8");
}

/** The policy's title: the file's first `# ` heading. */
export function realPolicyTitle(name: string): string {
  return /^#\s+(.+)$/m.exec(realPolicyText(name))?.[1] ?? name;
}

export function readRealPolicyBundle(name: string): RealPolicyBundle {
  known(name);
  const path = realPolicyBundlePath(name);
  if (!existsSync(path)) throw new Error(`real policy "${name}" has no compiled bundle at fixtures/real/policies/${name}.compiled.json; run pnpm eval:policies`);
  return JSON.parse(readFileSync(path, "utf8")) as RealPolicyBundle;
}

/**
 * Blocking issue codes that only say the policy is not fully automated: a clause, or a required paragraph, that no
 * rule carries. Every other blocking code is about the rules or monitors themselves (a malformed guard, an unknown
 * predicate, an unhandled indeterminate result, a failed scenario, ...). PARAGRAPH_UNCOVERED is only ever a warning.
 */
export const COVERAGE_ISSUE_CODES: readonly string[] = ["CLAUSE_DROPPED"];

export interface RealCompiledPolicy extends CompiledPolicy {
  /** With `allowCoverageGaps`, the blocking coverage issues the policy was loaded despite; empty for a validated policy. */
  coverageGaps: string[];
}

export interface LoadRealPolicyOptions {
  /**
   * Load a COMPILE_FAILED policy whose every blocking issue is a coverage issue: its rules and monitors passed every
   * other check, and they simply do not automate all of the policy. Used to evaluate real calls under the rules the
   * policy did get (Task 37); the app itself never activates such a policy.
   */
  allowCoverageGaps?: boolean;
  /** The bundle to load; read from `fixtures/real/policies/<name>.compiled.json` when not given. */
  bundle?: RealPolicyBundle;
}

/**
 * The compiled rules and monitors for a real policy. Throws, naming the policy, when the policy did not validate
 * (unless `allowCoverageGaps` and only coverage issues block), when its bundle is missing, or when the policy text
 * has changed since the bundle was written.
 */
export function loadRealPolicy(name: string, options: LoadRealPolicyOptions = {}): RealCompiledPolicy {
  known(name);
  const bundle = options.bundle ?? readRealPolicyBundle(name);
  const textHash = sha256Hex(realPolicyText(name).replace(/\r\n?/g, "\n"));
  if (bundle.sourceTextHash !== textHash) throw new Error(`real policy "${name}" was compiled from different text than fixtures/real/policies/${name}.md; run pnpm eval:policies`);
  const blocking = bundle.issues.filter((i) => i.severity === "blocking");
  const compiled = () => ({ rules: compileRules(RulesDocSchema.parse(bundle.rulesDoc)), monitors: MonitorsDocSchema.parse({ monitors: bundle.monitors }).monitors });
  if (!bundle.compileError && bundle.rulesDoc && bundle.status === "VALIDATED") return { ...compiled(), coverageGaps: [] };
  const onlyCoverage = blocking.length > 0 && blocking.every((i) => COVERAGE_ISSUE_CODES.includes(i.code));
  if (options.allowCoverageGaps && !bundle.compileError && bundle.rulesDoc && bundle.rulesDoc.rules.length > 0 && onlyCoverage) {
    return { ...compiled(), coverageGaps: blocking.map((i) => `${i.code}: ${i.message}`) };
  }
  const why = bundle.compileError ? `${bundle.compileError.code}: ${bundle.compileError.message}` : [...new Set(blocking.map((i) => i.code))].join(", ") || "no rules";
  const hint = !options.allowCoverageGaps && onlyCoverage && !bundle.compileError ? "; only coverage issues block, so it loads with { allowCoverageGaps: true }" : "";
  throw new Error(`real policy "${name}" did not validate (${bundle.status}): ${why}${hint}`);
}

// ── Scoring real calls (Task 37) ────────────────────────────────────────────

/** What happened to one labelled turn: hidden, never quoted by any claim, or quoted only by claims nothing flagged. */
export type TurnOutcome = "hidden" | "not_extracted" | "extracted_not_flagged";

export interface RealCaseScore {
  id: string;
  policy: string;
  labelled: number;
  hidden: number;
  notExtracted: string[];
  /** `covered` comes from `coverage-<policy>.json`: true when the policy has a clause that applies, false when none, null when not yet judged. */
  extractedNotFlagged: { turn: string; covered: boolean | null }[];
  /** Unlabelled turns quoted by a flagged claim: the other passages Blink hid. */
  otherHidden: number;
  /** Every turn a flagged claim quotes, labelled or not, in turn order. Repeat runs compare these. */
  hiddenTurns: string[];
  /** Claims the after-call read kept (expert and analyst). */
  claims: number;
  /** Why the call could not be scored (the analysis failed); null when it was. A failed call is never counted as hidden. */
  error: string | null;
  /** Dollars of model calls for this case; null when a call had no listed price. */
  spendUsd: number | null;
  /** 1-based run number when the set is run more than once. */
  run: number;
}

/** Monitor end states that hide what a claim quotes (spec section 5). */
export const HIDING_STATES: readonly string[] = ["REVIEW_REQUIRED", "ESCALATION_REQUESTED", "NEEDS_CONTEXT"];

const turnNo = (label: string) => Number(/\d+/.exec(label)?.[0] ?? Number.MAX_SAFE_INTEGER);
const byTurn = (a: string, b: string) => turnNo(a) - turnNo(b) || a.localeCompare(b);

/**
 * Scores one call under one policy. A labelled turn is hidden when a hidden claim quotes it; not extracted when no
 * claim quotes it; otherwise extracted but not flagged. A claim is hidden when `hidden` says so (the runner sets it
 * from the case's uncleared policy findings), or, when `hidden` is not given, when its monitors end in
 * REVIEW_REQUIRED, ESCALATION_REQUESTED or NEEDS_CONTEXT. Pure: the caller supplies the claims and the coverage.
 */
export function scoreRealCase(labels: { turn: string }[], claims: { turns: string[]; state: string; hidden?: boolean }[], coverage: Record<string, boolean>, meta: { id?: string; policy?: string } = {}): RealCaseScore {
  const labelled = [...new Set(labels.map((l) => l.turn))].sort(byTurn);
  const hiddenTurns = new Set(claims.filter((c) => c.hidden ?? HIDING_STATES.includes(c.state)).flatMap((c) => c.turns));
  const quoted = new Set(claims.flatMap((c) => c.turns));
  const score: RealCaseScore = { id: meta.id ?? "", policy: meta.policy ?? "", labelled: labelled.length, hidden: 0, notExtracted: [], extractedNotFlagged: [], otherHidden: 0, hiddenTurns: [...hiddenTurns].sort(byTurn), claims: claims.length, error: null, spendUsd: null, run: 1 };
  for (const turn of labelled) {
    if (hiddenTurns.has(turn)) score.hidden++;
    else if (!quoted.has(turn)) score.notExtracted.push(turn);
    else score.extractedNotFlagged.push({ turn, covered: Object.hasOwn(coverage, turn) ? coverage[turn] : null });
  }
  score.otherHidden = [...hiddenTurns].filter((t) => !labelled.includes(t)).length;
  return score;
}

/** The policy run for comparison only: the demo policy's labelled hand-written fallback. Never counted against a pass bar. */
export const DEMO_POLICY = "demo";

/** The calls in a set: every folder that holds a transcript, in name order. */
export function realCallsIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "transcript.txt")))
    .map((e) => e.name)
    .sort();
}

/** The shape of `coverage-<policy>.json`: turn label → whether the policy covers it, and the clause (quoted, or "none"). */
export const CoverageFileSchema = z.record(z.string().regex(/^T\d+$/, "a turn label such as T4"), z.strictObject({ covered: z.boolean(), clause: z.string().min(1) }));

/** `coverage-<policy>.json` beside the call, read as turn → covered. A file of the wrong shape is refused. */
export function readCoverage(callDir: string, policy: string): Record<string, boolean> {
  const path = join(callDir, `coverage-${policy}.json`);
  if (!existsSync(path)) return {};
  const raw = CoverageFileSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  return Object.fromEntries(Object.entries(raw).map(([turn, v]) => [turn, v.covered]));
}

/**
 * A name for an error that carries no text from what failed: its code (`LLM_REFUSAL`, `VALIDATION`) or else its
 * class name (`SyntaxError`, `ZodError`). Messages can quote the input (a transcript line, a JSON file), so they are
 * kept out of anything `--counts-only` prints or writes.
 */
export function errorCode(err: unknown): string {
  const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)) return code;
  return err instanceof Error ? err.name : "UnknownError";
}

/** The error as stored on a score: its code alone with `countsOnly`, otherwise code and message. */
function describeError(err: unknown, countsOnly: boolean): string {
  const code = errorCode(err);
  return countsOnly ? code : `${code}: ${err instanceof Error ? err.message : String(err)}`;
}

interface InstalledPolicy {
  name: string;
  versionId: string;
  /** Blocking coverage issues the policy was loaded despite (always 0 for the demo policy). */
  coverageGaps: number;
}

const OWNER_ID = "user_dana";
const ANALYST_ID = "user_priya";

/** Puts each policy in the database as its own version. Real policies go through the same validator; none is approved. */
function installPolicies(names: string[]): InstalledPolicy[] {
  return names.map((name) =>
    transact((tx) => {
      const owner = loadActor(tx, OWNER_ID);
      if (name === DEMO_POLICY) {
        const { policyVersionId } = createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1.md"), owner);
        const result = loadManualFallback(tx, policyVersionId, owner);
        if (result.status !== "VALIDATED") throw new Error("the demo policy's manual fallback did not validate");
        return { name, versionId: policyVersionId, coverageGaps: 0 };
      }
      // Refuses an unknown name, a stale bundle, and any blocking issue that is not a coverage gap.
      const loaded = loadRealPolicy(name, { allowCoverageGaps: true });
      const bundle = readRealPolicyBundle(name);
      const policy = known(name);
      const { policyVersionId } = createPolicy(tx, { title: realPolicyTitle(name), text: realPolicyText(name), requiredParagraphs: policy.requiredParagraphs }, owner);
      finalizeCompile(tx, policyVersionId, { inventory: bundle.inventory, rulesDoc: bundle.rulesDoc, monitors: bundle.monitors, compileSource: "ai" }, "system");
      return { name, versionId: policyVersionId, coverageGaps: loaded.coverageGaps.length };
    }),
  );
}

/**
 * Each claim's turns, whether the app would hide what it quotes, and (for the report) its monitors' aggregate end
 * state. Hidden is read the way `restrictedOnCase` and `hiddenBy` read it: the case has a policy finding on the
 * claim that compliance has not cleared. So the app's own rules decide, including `persistMonitorRuns` opening no
 * finding for a claim that settles quietly, and nothing here re-derives them from monitor states.
 */
function claimStates(caseId: string, policyVersionId: string) {
  const db = getDb();
  const findings = eligibilityForCase(db, caseId).findings.filter((f) => f.origin === "policy" && !findingCleared(f));
  return loadCurrentClaims(db, caseId)
    .filter((c) => c.row.status !== "rejected")
    .map((c) => {
      const instances = db.select().from(monitorInstances).where(and(eq(monitorInstances.caseId, caseId), eq(monitorInstances.claimLogicalKey, c.row.logicalKey), eq(monitorInstances.policyVersionId, policyVersionId))).all();
      const hidden = findings.some((f) => f.claimLogicalKey === c.row.logicalKey);
      return { key: c.row.logicalKey, turns: c.turnLabels, hidden, state: aggregateMonitorStates(instances.map((i) => i.state)), speaker: c.fields.speaker, summary: c.fields.summary, quotes: c.quotes.map((q) => `${q.turnLabel}: "${q.quote}"`) };
    });
}

/** Dollars for logged model calls, and how many had no listed price (an unknown cost is never counted as zero). */
export function priceCalls(rows: readonly (typeof llmCalls.$inferSelect)[]): { usd: number; unpriced: number } {
  let usd = 0;
  let unpriced = 0;
  for (const c of rows) {
    const one = costUsd({ input_tokens: c.inputTokens, output_tokens: c.outputTokens, cache_read_input_tokens: c.cacheReadTokens, cache_creation_input_tokens: c.cacheCreationTokens }, c.model);
    if (one === null) unpriced++;
    else usd += one;
  }
  return { usd, unpriced };
}

function caseSpend(caseId: string): number | null {
  const { usd, unpriced } = priceCalls(getDb().select().from(llmCalls).where(like(llmCalls.refJson, `%${caseId}%`)).all());
  return unpriced > 0 ? null : usd;
}

/** One line of numbers, ids and turn labels: no word of the transcript. With `countsOnly`, an error shows only its code. */
export function countsLine(s: RealCaseScore, countsOnly = true): string {
  const list = (xs: string[]) => (xs.length ? ` [${xs.join(",")}]` : "");
  const nf = (c: boolean | null) => s.extractedNotFlagged.filter((t) => t.covered === c).map((t) => t.turn);
  if (s.error) return `${s.id} · ${s.policy} · run ${s.run}: ERROR (${countsOnly ? (/^[A-Za-z][A-Za-z0-9_]*/.exec(s.error)?.[0] ?? "UnknownError") : s.error.slice(0, 200)})`;
  return [
    `${s.id} · ${s.policy} · run ${s.run}: labelled ${s.labelled}`,
    `hidden ${s.hidden}`,
    `not extracted ${s.notExtracted.length}${list(s.notExtracted)}`,
    `not flagged, covered ${nf(true).length}${list(nf(true))}`,
    `not flagged, not covered ${nf(false).length}${list(nf(false))}`,
    `not flagged, not judged ${nf(null).length}${list(nf(null))}`,
    `other hidden ${s.otherHidden}`,
    `hidden turns${list(s.hiddenTurns) || " none"}`,
    `claims ${s.claims}`,
    `$${s.spendUsd === null ? "unknown" : s.spendUsd.toFixed(3)}`,
  ].join(" · ");
}

export interface RealEvalOptions {
  /** A set folder: one sub-folder per call, each with packet.json, expert.json, labels.json, speakers.json, transcript.txt. */
  dir: string;
  /** Real policy names, and `demo` for the demo policy. */
  policies: string[];
  /** Print numbers, ids and turn labels only, never a word of transcript (for material that may not be shown). */
  countsOnly: boolean;
  /** Only these calls (folder names); all of them when not given. */
  calls?: string[];
  /** The run number to stamp on the scores. */
  run?: number;
  log?: (line: string) => void;
}

/**
 * For each call and policy: creates a case from the call's packet, uploads its transcript, runs the after-call
 * pipeline (extraction, quote grounding, comparison, policy evaluation) through the job queue, and scores it.
 * Uses the configured database; users are seeded if missing. Real policies are loaded despite coverage gaps and
 * never approved; the case is pointed at the version directly.
 */
export async function runRealEval(opts: RealEvalOptions): Promise<RealCaseScore[]> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const run = opts.run ?? 1;
  for (const name of opts.policies) if (name !== DEMO_POLICY) known(name);
  const all = realCallsIn(opts.dir);
  const unknownCalls = (opts.calls ?? []).filter((c) => !all.includes(c));
  if (unknownCalls.length > 0) throw new Error(`no call ${unknownCalls.join(", ")} in ${opts.dir}; the calls are ${all.join(", ")}`);
  const calls = opts.calls ? all.filter((c) => opts.calls!.includes(c)) : all;

  seedUsersOnly();
  const policies = installPolicies(opts.policies);
  for (const p of policies) log(p.name === DEMO_POLICY ? `policy demo: the demo policy's hand-written fallback, for comparison only` : `policy ${p.name}: compiled with ${p.coverageGaps} blocking coverage issue${p.coverageGaps === 1 ? "" : "s"}`);

  const scores: RealCaseScore[] = [];
  // A call that cannot be set up or scored is reported as an error on its score, never thrown: an error's message
  // can quote the call's files, and with countsOnly only its code may be shown.
  const failedScore = (id: string, policy: string, labels: { turn: string }[], err: unknown): RealCaseScore => ({ ...scoreRealCase(labels, [], {}, { id, policy }), run, error: describeError(err, opts.countsOnly) });
  for (const id of calls) {
    const callDir = join(opts.dir, id);
    const read = (file: string) => readFileSync(join(callDir, file), "utf8");
    let setup: { labels: { turn: string }[]; speakers: Record<string, "analyst" | "expert" | "moderator">; transcript: string; input: ReturnType<typeof CreateCaseSchema.parse> };
    try {
      const expert = JSON.parse(read("expert.json")) as Record<string, unknown>;
      setup = {
        labels: (JSON.parse(read("labels.json")) as { labels: { turn: string }[] }).labels,
        speakers: JSON.parse(read("speakers.json")) as Record<string, "analyst" | "expert" | "moderator">,
        transcript: read("transcript.txt"),
        input: CreateCaseSchema.parse({ ...(JSON.parse(read("packet.json")) as Record<string, unknown>), expert }),
      };
    } catch (err) {
      for (const policy of policies) {
        const score = failedScore(id, policy.name, [], err);
        scores.push(score);
        log(countsLine(score, opts.countsOnly));
      }
      continue;
    }
    const { labels, speakers, transcript, input } = setup;

    for (const policy of policies) {
      let score: RealCaseScore;
      let claims: ReturnType<typeof claimStates> = [];
      try {
        const caseId = transact((tx) => {
          const created = createCase(tx, input, loadActor(tx, ANALYST_ID));
          tx.update(cases).set({ activePolicyVersionId: policy.versionId }).where(eq(cases.id, created.caseId)).run();
          uploadTranscript(tx, created.caseId, { text: transcript, filename: `${id}.txt`, sourceLabel: `real call ${id}`, speakerMap: speakers, source: "ai" }, loadActor(tx, ANALYST_ID));
          return created.caseId;
        });
        await drainJobs();
        const analysis = latestRun(getDb(), caseId);
        const failed = !analysis || analysis.status !== "succeeded";
        claims = failed ? [] : claimStates(caseId, policy.versionId);
        score = scoreRealCase(labels, claims, readCoverage(callDir, policy.name), { id, policy: policy.name });
        score.run = run;
        score.spendUsd = caseSpend(caseId);
        if (failed) {
          // A run's error is "CODE: message"; the message may quote the model's answer, so countsOnly keeps the code.
          const stored = analysis?.error ?? "ANALYSIS_NOT_RUN: the analysis did not run";
          const code = /^([A-Z][A-Z0-9_]*):/.exec(stored)?.[1] ?? "ANALYSIS_FAILED";
          score.error = opts.countsOnly ? code : stored;
        }
      } catch (err) {
        score = failedScore(id, policy.name, labels, err);
        claims = [];
      }
      scores.push(score);
      log(countsLine(score, opts.countsOnly));
      if (!opts.countsOnly) {
        for (const c of claims) {
          log(`    ${c.key} ${c.turns.join("+")} · ${c.speaker} · ${c.hidden ? "hidden" : "not hidden"} (monitors ${c.state}) · ${c.summary}`);
          for (const q of c.quotes) log(`        ${q}`);
        }
      }
    }
  }
  return scores;
}

/** Turn sets that recur across repeat runs: for each call and policy, how many runs gave the most common hidden turns. */
export function repeatAgreement(scores: RealCaseScore[]): { id: string; policy: string; runs: number; agreeing: number; modal: string[]; errors: number }[] {
  const groups = new Map<string, RealCaseScore[]>();
  for (const s of scores) groups.set(`${s.id}\u0000${s.policy}`, [...(groups.get(`${s.id}\u0000${s.policy}`) ?? []), s]);
  return [...groups.values()].map((runs) => {
    const counts = new Map<string, number>();
    for (const r of runs.filter((r) => !r.error)) counts.set(r.hiddenTurns.join(","), (counts.get(r.hiddenTurns.join(",")) ?? 0) + 1);
    const [modal, agreeing] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    return { id: runs[0].id, policy: runs[0].policy, runs: runs.length, agreeing, modal: modal ? modal.split(",") : [], errors: runs.filter((r) => r.error).length };
  });
}
