/**
 * Policy versions (§8): create, compile, validate, approve, activate.
 *
 * The lifecycle is the fixed machine in `core/workflow/policyVersion.ts`.
 * A compile — AI or manual — always ends in `finalizeCompile`, which runs the
 * validator, the scenarios, and the deterministic preview, and computes the
 * bundle hash the owner approves. A version that fails any blocking check is
 * COMPILE_FAILED and can never become ACTIVE.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { hashOf, sha256Hex } from "@/core/deps/hash";
import { decompilePolicy } from "@/core/policy/decompile";
import { type Scenario, type ScenarioReport, ScenarioFileSchema, runScenarios, scenarioIssues } from "@/core/policy/scenarios";
import { type Inventory, InventorySchema, type Monitor, type RulesDoc, RulesDocSchema, MonitorsDocSchema, buildGuardTree, parsePolicyParagraphs } from "@/core/policy/schema";
import { ASSEMBLY_LEVEL_CODES, type CompiledRule, RULE_LEVEL_CODES, type ValidationIssue, type ValidationReport, validatePolicy } from "@/core/policy/validate";
import { isImmutable, transitionPolicyVersion } from "@/core/workflow/policyVersion";
import { type Actor, requireRole } from "../auth/actor";
import { appendAudit } from "../audit/log";
import { nowIso } from "../clock";
import { type DbOrTx, fromJson, toJson } from "../db/client";
import { cases, compileAttempts, llmCalls, policySources, policyVersions } from "../db/schema";
import { AppError, conflict, forbidden, notFound, unprocessable } from "../errors";
import { newId } from "../ids";
import { enqueueJob } from "../jobs/queue";
import { reevaluateCase } from "./evaluation";
import { type PolicyVersionRow, getPolicyVersion } from "./loaders";

export type PolicySourceRow = typeof policySources.$inferSelect;

export const CreatePolicySchema = z.strictObject({
  title: z.string().trim().min(3),
  text: z.string().trim().min(20, "paste the policy text"),
  /** Paragraph ids the owner marks as "must be automated" (§8.3, §17.3). Default: none. */
  requiredParagraphs: z.array(z.string().regex(/^P\d+$/)).default([]),
  /** Reviewer-authored scenarios (§8.6), in the shape of fixtures/policy/scenarios-v1.json. */
  scenarios: z.unknown().optional(),
});
export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>;

export interface ValidationBundle extends ValidationReport {
  /** Set when a compile could not run at all (model refusal, replay miss, …). */
  compileError?: { code: string; message: string } | null;
}

export interface ScenarioBundle {
  reviewer: ScenarioReport | null;
  ai: ScenarioReport | null;
}

function nextLabel(tx: DbOrTx): string {
  return `v${tx.select({ id: policyVersions.id }).from(policyVersions).all().length + 1}`;
}

export function getPolicySource(db: DbOrTx, id: string): PolicySourceRow {
  const row = db.select().from(policySources).where(eq(policySources.id, id)).get();
  if (!row) throw notFound("policy source");
  return row;
}

export function createPolicy(tx: DbOrTx, input: CreatePolicyInput, actor: Actor): { policySourceId: string; policyVersionId: string; label: string } {
  requireRole(actor, "policy_owner");
  const text = input.text.replace(/\r\n?/g, "\n");
  const paragraphs = parsePolicyParagraphs(text);
  if (paragraphs.length === 0) throw new AppError(400, "VALIDATION", "no policy paragraphs were found in the text");
  const unknown = input.requiredParagraphs.filter((p) => !paragraphs.some((x) => x.id === p));
  if (unknown.length > 0) throw new AppError(400, "VALIDATION", `required paragraph${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")} not found in the policy text`);
  let scenariosJson: string | null = null;
  if (input.scenarios !== undefined && input.scenarios !== null) {
    const parsed = ScenarioFileSchema.safeParse(input.scenarios);
    if (!parsed.success) throw new AppError(400, "VALIDATION", `the scenario file is not valid: ${parsed.error.issues[0]?.message ?? "schema error"}`);
    scenariosJson = toJson(parsed.data);
  }

  const now = nowIso();
  const sourceId = newId("pol");
  tx.insert(policySources).values({ id: sourceId, title: input.title, text, textHash: sha256Hex(text), requiredParagraphsJson: toJson(input.requiredParagraphs), scenariosJson, createdBy: actor.id, createdAt: now }).run();
  const versionId = newId("pv");
  const label = nextLabel(tx);
  tx.insert(policyVersions).values({ id: versionId, policySourceId: sourceId, label, status: "DRAFT", compileSource: "ai", createdAt: now, version: 1 }).run();
  appendAudit(tx, { actorId: actor.id, type: "POLICY_CREATED", entityType: "policy_version", entityId: versionId, payload: { label, title: input.title, text_hash: sha256Hex(text), paragraphs: paragraphs.length, required_paragraphs: input.requiredParagraphs, reviewer_scenarios: scenariosJson ? (JSON.parse(scenariosJson) as { scenarios: unknown[] }).scenarios.length : 0 } });
  return { policySourceId: sourceId, policyVersionId: versionId, label };
}

function assertMutable(version: PolicyVersionRow): void {
  if (isImmutable(version.status)) throw unprocessable(`policy ${version.label} is ${version.status} and immutable; create a new version instead`, "POLICY_IMMUTABLE");
}

function throwTransition(error: "FORBIDDEN_ROLE" | "INVALID_TRANSITION" | "HASH_MISMATCH", message: string): never {
  if (error === "FORBIDDEN_ROLE") throw forbidden(message);
  if (error === "HASH_MISMATCH") throw conflict(message, "BUNDLE_HASH_MISMATCH");
  throw unprocessable(message, "POLICY_TRANSITION");
}

/** POST /api/policies/:id/compile — moves the version to COMPILING and enqueues the job. */
export function requestCompile(tx: DbOrTx, versionId: string, actor: Actor): { jobId: string } {
  const version = getPolicyVersion(tx, versionId);
  const next = transitionPolicyVersion(version.status, { type: "COMPILE_REQUESTED" }, actor.role);
  if (!next.ok) throwTransition(next.error, next.message);
  const job = enqueueJob(tx, "compile_policy", { policyVersionId: versionId, requestedBy: actor.id, request: newId("cmp") });
  tx.update(policyVersions).set({ status: next.next, compileSource: "ai", compileJobId: job.id, version: version.version + 1 }).where(eq(policyVersions.id, versionId)).run();
  appendAudit(tx, { actorId: actor.id, type: "POLICY_COMPILE_REQUESTED", entityType: "policy_version", entityId: versionId, payload: { label: version.label, job: job.id } });
  return { jobId: job.id };
}

export function recordAttempt(tx: DbOrTx, input: { policyVersionId: string; stage: string; attemptNo: number; input: unknown; output: unknown; issues: ValidationIssue[]; llmCallId?: string | null }): void {
  tx.insert(compileAttempts)
    .values({ id: newId("att"), policyVersionId: input.policyVersionId, stage: input.stage, attemptNo: input.attemptNo, inputHash: hashOf(input.input ?? null), outputJson: toJson(input.output), issuesJson: toJson(input.issues), llmCallId: input.llmCallId ?? null, createdAt: nowIso() })
    .run();
}

export function bundleHashOf(parts: { sourceText: string; inventory: unknown; rules: unknown; monitors: unknown; validation: unknown; scenarios: unknown }): string {
  // The hash covers source text, inventory, rules, monitors, validation report, and scenario report (§8.1).
  return hashOf({ source_text: parts.sourceText, inventory: parts.inventory ?? null, rules: parts.rules ?? null, monitors: parts.monitors ?? null, validation: parts.validation ?? null, scenarios: parts.scenarios ?? null });
}

export interface CompileArtifacts {
  inventory: Inventory | null;
  rulesDoc: unknown;
  monitors: unknown;
  /** AI-proposed scenarios, if that stage ran. */
  aiScenarios?: Scenario[] | null;
  compileSource: "ai" | "manual";
  /** A failure that stopped the compile before validation could run. */
  compileError?: { code: string; message: string } | null;
}

export interface FinalizeResult {
  status: "VALIDATED" | "COMPILE_FAILED";
  bundleHash: string;
  blocking: number;
  warnings: number;
}

/**
 * The deterministic end of every compile: validate → reviewer scenarios (the
 * activation gate) → AI scenarios (warnings only) → preview → bundle hash.
 */
export function finalizeCompile(tx: DbOrTx, versionId: string, artifacts: CompileArtifacts, actorId: string): FinalizeResult {
  const version = getPolicyVersion(tx, versionId);
  assertMutable(version);
  const source = getPolicySource(tx, version.policySourceId);
  const paragraphs = parsePolicyParagraphs(source.text);
  const requiredParagraphs = fromJson<string[]>(source.requiredParagraphsJson, []);

  const validation: ValidationBundle = validatePolicy({ source: { paragraphs, requiredParagraphs }, inventory: artifacts.inventory, rulesDoc: artifacts.rulesDoc ?? { rules: [], unsupported_clauses: [] }, monitorsDoc: { monitors: artifacts.monitors ?? [] } });
  validation.compileError = artifacts.compileError ?? null;
  if (artifacts.compileError) {
    validation.issues.unshift({ code: "SCHEMA_INVALID", severity: "blocking", message: `compile stopped: ${artifacts.compileError.code} — ${artifacts.compileError.message}` });
  }

  const rulesParsed = RulesDocSchema.safeParse(artifacts.rulesDoc);
  const monitorsParsed = MonitorsDocSchema.safeParse({ monitors: artifacts.monitors ?? [] });
  const scenarios: ScenarioBundle = { reviewer: null, ai: null };
  let preview = "";

  if (rulesParsed.success && monitorsParsed.success) {
    const rulesDoc: RulesDoc = rulesParsed.data;
    const monitors: Monitor[] = monitorsParsed.data.monitors;
    // Scenarios run only against rules whose guards are well-formed; a malformed guard is already a blocker.
    const compiled = new Map<string, CompiledRule>();
    for (const rule of rulesDoc.rules) {
      const built = buildGuardTree(rule.guard);
      if (built.ok && !compiled.has(rule.rule_id)) compiled.set(rule.rule_id, { rule, guard: built.tree });
    }
    const policyForScenarios = { rules: compiled, monitors, inventory: artifacts.inventory, paragraphs };
    const reviewerScenarios = fromJson<{ scenarios: Scenario[] } | null>(source.scenariosJson, null)?.scenarios ?? null;
    if (reviewerScenarios) {
      scenarios.reviewer = runScenarios(reviewerScenarios, policyForScenarios, "reviewer");
      validation.issues.push(...scenarioIssues(scenarios.reviewer));
    }
    if (artifacts.aiScenarios && artifacts.aiScenarios.length > 0) {
      scenarios.ai = runScenarios(artifacts.aiScenarios, policyForScenarios, "ai");
      validation.issues.push(...scenarioIssues(scenarios.ai));
    }
    preview = decompilePolicy({ title: source.title, inventory: artifacts.inventory, rulesDoc, monitors, enumeration: validation.enumeration });
  }

  validation.ok = !validation.issues.some((i) => i.severity === "blocking");
  const blocking = validation.issues.filter((i) => i.severity === "blocking").length;
  const status = validation.ok ? ("VALIDATED" as const) : ("COMPILE_FAILED" as const);
  const stored = { inventory: artifacts.inventory, rules: artifacts.rulesDoc ?? null, monitors: { monitors: artifacts.monitors ?? [] } };
  const bundleHash = bundleHashOf({ sourceText: source.text, inventory: stored.inventory, rules: stored.rules, monitors: stored.monitors, validation, scenarios });

  tx.update(policyVersions)
    .set({
      status,
      compileSource: artifacts.compileSource,
      inventoryJson: toJson(stored.inventory),
      rulesJson: toJson(stored.rules),
      monitorsJson: toJson(stored.monitors),
      validationJson: toJson(validation),
      scenarioReportJson: toJson(scenarios),
      previewMd: preview,
      bundleHash,
      version: version.version + 1,
    })
    .where(eq(policyVersions.id, versionId))
    .run();
  appendAudit(tx, {
    actorId,
    type: status === "VALIDATED" ? "POLICY_VALIDATED" : "POLICY_COMPILE_FAILED",
    entityType: "policy_version",
    entityId: versionId,
    payload: {
      label: version.label,
      compile_source: artifacts.compileSource,
      bundle_hash: bundleHash,
      blocking: validation.issues.filter((i) => i.severity === "blocking").map((i) => i.code),
      warnings: validation.issues.filter((i) => i.severity === "warning").length,
      combinations: validation.totals.combinations,
      reviewer_scenarios: scenarios.reviewer ? `${scenarios.reviewer.passed}/${scenarios.reviewer.total}` : null,
    },
  });
  return { status, bundleHash, blocking, warnings: validation.issues.length - blocking };
}

const MANUAL_FILE = "fixtures/policy/manual-monitors-v1.json";

/** POST /api/policies/:id/use-manual — loads the labeled hand-written fallback (§8.9) through the same gate. */
export function loadManualFallback(tx: DbOrTx, versionId: string, actor: Actor): FinalizeResult {
  requireRole(actor, "policy_owner");
  const version = getPolicyVersion(tx, versionId);
  assertMutable(version);
  if (version.status === "COMPILING") throw unprocessable("a compile is running for this version; wait for it to finish", "POLICY_TRANSITION");
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), MANUAL_FILE), "utf8")) as { inventory: unknown; rules: unknown; unsupported_clauses: unknown; monitors: unknown };
  const inventory = InventorySchema.parse(raw.inventory);
  const rulesDoc = { rules: raw.rules, unsupported_clauses: raw.unsupported_clauses };
  // Park the version in COMPILING so finalize sees the same starting point as an AI compile.
  tx.update(policyVersions).set({ status: "COMPILING", compileSource: "manual", version: version.version + 1 }).where(eq(policyVersions.id, versionId)).run();
  recordAttempt(tx, { policyVersionId: versionId, stage: "manual", attemptNo: 1, input: MANUAL_FILE, output: { file: MANUAL_FILE }, issues: [] });
  appendAudit(tx, { actorId: actor.id, type: "POLICY_MANUAL_FALLBACK_LOADED", entityType: "policy_version", entityId: versionId, payload: { label: version.label, file: MANUAL_FILE } });
  return finalizeCompile(tx, versionId, { inventory, rulesDoc, monitors: raw.monitors, compileSource: "manual" }, actor.id);
}

/** POST /api/policies/:id/approve — the owner approves the exact bundle hash; the version becomes ACTIVE. */
export function approvePolicy(tx: DbOrTx, versionId: string, bundleHash: string, actor: Actor): { activated: string; superseded: string[]; casesReevaluated: string[] } {
  const version = getPolicyVersion(tx, versionId);
  const next = transitionPolicyVersion(version.status, { type: "APPROVE", bundleHash, storedBundleHash: version.bundleHash }, actor.role);
  if (!next.ok) throwTransition(next.error, next.message);

  // The stored artifacts must still hash to what was validated: nothing may change between validation and approval.
  const source = getPolicySource(tx, version.policySourceId);
  const recomputed = bundleHashOf({
    sourceText: source.text,
    inventory: fromJson(version.inventoryJson, null),
    rules: fromJson(version.rulesJson, null),
    monitors: fromJson(version.monitorsJson, null),
    validation: fromJson(version.validationJson, null),
    scenarios: fromJson(version.scenarioReportJson, null),
  });
  if (recomputed !== version.bundleHash) throw conflict("the stored policy bundle no longer matches its hash; recompile before approving", "BUNDLE_HASH_MISMATCH");
  const validation = fromJson<ValidationBundle | null>(version.validationJson, null);
  if (!validation?.ok) throw unprocessable("this version has blocking validation issues and cannot be activated", "POLICY_TRANSITION");

  const now = nowIso();
  const superseded: string[] = [];
  for (const active of tx.select().from(policyVersions).where(eq(policyVersions.status, "ACTIVE")).all()) {
    const s = transitionPolicyVersion(active.status, { type: "SUPERSEDE" }, "system");
    if (!s.ok) continue;
    tx.update(policyVersions).set({ status: s.next, supersededAt: now, version: active.version + 1 }).where(eq(policyVersions.id, active.id)).run();
    superseded.push(active.id);
    appendAudit(tx, { actorId: "system", type: "POLICY_SUPERSEDED", entityType: "policy_version", entityId: active.id, payload: { label: active.label, by: version.label } });
  }
  tx.update(policyVersions).set({ status: next.next, approvedBy: actor.id, approvedAt: now, activatedAt: now, version: version.version + 1 }).where(eq(policyVersions.id, versionId)).run();
  appendAudit(tx, { actorId: actor.id, type: "POLICY_ACTIVATED", entityType: "policy_version", entityId: versionId, payload: { label: version.label, bundle_hash: version.bundleHash, compile_source: version.compileSource, superseded } });

  // Every case moves to the new version. Decisions and approvals made under the old
  // one depended on its bundle hash, so the staleness pass reopens them (§8.1).
  const casesReevaluated: string[] = [];
  for (const c of tx.select().from(cases).all()) {
    if (c.activePolicyVersionId === versionId) continue;
    tx.update(cases).set({ activePolicyVersionId: versionId, version: c.version + 1 }).where(eq(cases.id, c.id)).run();
    if (c.status === "INTAKE" || c.status === "ANALYZING") continue; // nothing extracted yet; analysis will use the new version
    reevaluateCase(tx, c.id, { actorId: "system", reason: `policy ${version.label} activated`, eventType: "CLAIM_EVALUATED", eventToken: `policy:${versionId}` });
    casesReevaluated.push(c.id);
  }
  return { activated: versionId, superseded, casesReevaluated };
}

// ── Compile pipeline (§8.7) ─────────────────────────────────────────────────

export interface CompileSteps {
  passA(input: { paragraphs: ReturnType<typeof parsePolicyParagraphs> }): Promise<{ inventory: Inventory; callId: string | null }>;
  passB(input: { paragraphs: ReturnType<typeof parsePolicyParagraphs>; inventory: Inventory; feedback?: ValidationIssue[] }): Promise<{ rulesDoc: RulesDoc; callId: string | null }>;
  assemble(input: { rulesDoc: RulesDoc; feedback?: { issues: ValidationIssue[]; previous: Monitor[] } | null }): Promise<{ monitors: Monitor[]; callId: string | null }>;
  proposeScenarios(input: { rulesDoc: RulesDoc }): Promise<{ scenarios: Scenario[]; callId: string | null }>;
}

export const MAX_ASSEMBLY_ATTEMPTS = 3;
export const MAX_PASS_B_CALLS = 2;

export interface CompileOutcome extends CompileArtifacts {
  attempts: number;
  passBCalls: number;
}

/**
 * The repair loop of §8.7. Pure orchestration over injected steps, so tests
 * can drive it with scripted outputs and no network.
 *
 *   inventory = passA(); rules = passB(inventory)
 *   up to 3×: monitors = assemble(rules, feedback); issues = validate(...)
 *     only assembly-level blockers → feed them back and reassemble
 *     rule-level blockers          → back to passB (at most 2 calls in total)
 *     otherwise                    → stop
 */
export async function runCompileLoop(
  input: { paragraphs: ReturnType<typeof parsePolicyParagraphs>; requiredParagraphs: string[] },
  steps: CompileSteps,
  hooks: { onStage?: (stage: string, progress: number) => void; onAttempt?: (a: { stage: string; attemptNo: number; input: unknown; output: unknown; issues: ValidationIssue[]; callId: string | null }) => void } = {},
): Promise<CompileOutcome> {
  const stage = hooks.onStage ?? (() => undefined);
  const attempt = hooks.onAttempt ?? (() => undefined);
  const source = { paragraphs: input.paragraphs, requiredParagraphs: input.requiredParagraphs };

  stage("Pass A: clause inventory", 8);
  const a = await steps.passA({ paragraphs: input.paragraphs });
  attempt({ stage: "pass_a", attemptNo: 1, input: input.paragraphs, output: a.inventory, issues: [], callId: a.callId });

  stage("Pass B: typed rules", 28);
  let b = await steps.passB({ paragraphs: input.paragraphs, inventory: a.inventory });
  let passBCalls = 1;
  let rulesDoc = b.rulesDoc;
  let monitors: Monitor[] = [];
  let feedback: { issues: ValidationIssue[]; previous: Monitor[] } | null = null;
  let attempts = 0;
  // A pass-B output is judged by the validation that follows the next assembly, so its attempt row is written then.
  let pendingPassB: { attemptNo: number; input: unknown; callId: string | null } | null = { attemptNo: 1, input: a.inventory, callId: b.callId };

  for (let n = 1; n <= MAX_ASSEMBLY_ATTEMPTS; n++) {
    attempts = n;
    stage(`Assembling monitors (attempt ${n} of ${MAX_ASSEMBLY_ATTEMPTS})`, 40 + n * 10);
    const assembled = await steps.assemble({ rulesDoc, feedback });
    monitors = assembled.monitors;
    stage("Validating: enumerating evidence combinations", 45 + n * 10);
    const report = validatePolicy({ source, inventory: a.inventory, rulesDoc, monitorsDoc: { monitors } });
    const blockers = report.issues.filter((i) => i.severity === "blocking");
    const ruleLevel = blockers.filter((i) => RULE_LEVEL_CODES.includes(i.code));
    const assemblyLevel = blockers.filter((i) => ASSEMBLY_LEVEL_CODES.includes(i.code));
    if (pendingPassB) {
      attempt({ stage: "pass_b", attemptNo: pendingPassB.attemptNo, input: pendingPassB.input, output: rulesDoc, issues: ruleLevel, callId: pendingPassB.callId });
      pendingPassB = null;
    }
    attempt({ stage: "assembly", attemptNo: n, input: rulesDoc, output: { monitors }, issues: blockers, callId: assembled.callId });

    if (ruleLevel.length > 0) {
      // Back to extraction — but only while the budget lasts and an assembly remains to check the result.
      if (passBCalls >= MAX_PASS_B_CALLS || n === MAX_ASSEMBLY_ATTEMPTS) break;
      stage("Pass B: repairing rules from validator feedback", 30 + n * 10);
      b = await steps.passB({ paragraphs: input.paragraphs, inventory: a.inventory, feedback: ruleLevel });
      passBCalls++;
      rulesDoc = b.rulesDoc;
      feedback = null;
      pendingPassB = { attemptNo: passBCalls, input: { inventory: a.inventory, feedback: ruleLevel }, callId: b.callId };
      continue;
    }
    if (assemblyLevel.length > 0) {
      feedback = { issues: assemblyLevel, previous: monitors };
      continue;
    }
    break; // clean, or blocked by something neither step can repair
  }

  let aiScenarios: Scenario[] | null = null;
  const stillBlocked = validatePolicy({ source, inventory: a.inventory, rulesDoc, monitorsDoc: { monitors } }).issues.some((i) => i.severity === "blocking");
  if (!stillBlocked) {
    // Only worth a model call once the policy would otherwise validate.
    stage("Scenario tests: asking for adversarial traces", 82);
    const proposed = await steps.proposeScenarios({ rulesDoc });
    aiScenarios = proposed.scenarios;
    attempt({ stage: "scenarios", attemptNo: 1, input: rulesDoc, output: { scenarios: aiScenarios }, issues: [], callId: proposed.callId });
  }
  return { inventory: a.inventory, rulesDoc, monitors, aiScenarios, compileSource: "ai", attempts, passBCalls };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function listPolicyVersions(db: DbOrTx) {
  const versions = db.select().from(policyVersions).orderBy(desc(policyVersions.createdAt), desc(policyVersions.id)).all();
  const sources = new Map(db.select().from(policySources).all().map((s) => [s.id, s]));
  return versions.map((v) => {
    const validation = fromJson<ValidationBundle | null>(v.validationJson, null);
    const scenarios = fromJson<ScenarioBundle | null>(v.scenarioReportJson, null);
    return {
      id: v.id,
      label: v.label,
      title: sources.get(v.policySourceId)?.title ?? "",
      status: v.status,
      compileSource: v.compileSource,
      bundleHash: v.bundleHash,
      blocking: validation?.issues.filter((i) => i.severity === "blocking").length ?? 0,
      warnings: validation?.issues.filter((i) => i.severity === "warning").length ?? 0,
      combinations: validation?.totals.combinations ?? 0,
      monitors: validation?.totals.monitors ?? 0,
      reviewerScenarios: scenarios?.reviewer ? { passed: scenarios.reviewer.passed, total: scenarios.reviewer.total } : null,
      createdAt: v.createdAt,
      activatedAt: v.activatedAt,
      supersededAt: v.supersededAt,
      compileJobId: v.compileJobId,
      version: v.version,
    };
  });
}

export function policyDetail(db: DbOrTx, versionId: string) {
  const v = getPolicyVersion(db, versionId);
  const source = getPolicySource(db, v.policySourceId);
  const attempts = db.select().from(compileAttempts).where(eq(compileAttempts.policyVersionId, versionId)).all();
  const callIds = attempts.map((a) => a.llmCallId).filter((id): id is string => Boolean(id));
  const calls = callIds.length > 0 ? db.select().from(llmCalls).where(inArray(llmCalls.id, callIds)).all() : [];
  const replayedCalls = calls.filter((c) => c.replayed);
  return {
    id: v.id,
    label: v.label,
    status: v.status,
    compileSource: v.compileSource,
    version: v.version,
    bundleHash: v.bundleHash,
    compileJobId: v.compileJobId,
    createdAt: v.createdAt,
    approvedBy: v.approvedBy,
    approvedAt: v.approvedAt,
    activatedAt: v.activatedAt,
    supersededAt: v.supersededAt,
    source: { id: source.id, title: source.title, text: source.text, textHash: source.textHash, paragraphs: parsePolicyParagraphs(source.text), requiredParagraphs: fromJson<string[]>(source.requiredParagraphsJson, []), hasReviewerScenarios: source.scenariosJson !== null },
    inventory: fromJson<Inventory | null>(v.inventoryJson, null),
    rulesDoc: fromJson<RulesDoc | null>(v.rulesJson, null),
    monitors: fromJson<{ monitors: Monitor[] } | null>(v.monitorsJson, null)?.monitors ?? [],
    validation: fromJson<ValidationBundle | null>(v.validationJson, null),
    scenarios: fromJson<ScenarioBundle | null>(v.scenarioReportJson, null),
    previewMd: v.previewMd ?? "",
    /** Model calls behind this compile, and whether they were served from recordings (§13.3). */
    llm: { calls: calls.length, replayed: replayedCalls.length, recordedAt: replayedCalls.map((c) => c.recordedAt).filter(Boolean).sort().at(-1) ?? null },
    attempts: attempts
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
      .map((a) => ({ id: a.id, stage: a.stage, attemptNo: a.attemptNo, inputHash: a.inputHash, issues: fromJson<ValidationIssue[]>(a.issuesJson, []), llmCallId: a.llmCallId, createdAt: a.createdAt })),
  };
}
