/**
 * Job `compile_policy` (§8.7): plain language → inventory → rules → monitors,
 * with validator-driven repair, then the deterministic finalize step.
 *
 * Whatever happens — a clean compile, an exhausted repair budget, a refusal,
 * a replay miss — the version ends VALIDATED or COMPILE_FAILED, never ACTIVE.
 */
import { eq } from "drizzle-orm";
import { LlmScenariosSchema, llmScenariosToScenarios } from "@/core/policy/scenarios";
import { InventorySchema, LlmInventorySchema, LlmMonitorsSchema, LlmRulesSchema, MonitorsDocSchema, RulesDocSchema, llmRulesToDoc, parsePolicyParagraphs } from "@/core/policy/schema";
import { fromJson, getDb, transact } from "../../db/client";
import { policySources, policyVersions } from "../../db/schema";
import { LlmError, LlmSchemaError, structuredCall } from "../../llm/client";
import {
  ASSEMBLY_PROMPT_VERSION,
  ASSEMBLY_STAGE,
  ASSEMBLY_SYSTEM,
  PASS_A_PROMPT_VERSION,
  PASS_A_STAGE,
  PASS_A_SYSTEM,
  PASS_B_PROMPT_VERSION,
  PASS_B_STAGE,
  PASS_B_SYSTEM,
  SCENARIOS_PROMPT_VERSION,
  SCENARIOS_STAGE,
  SCENARIOS_SYSTEM,
  buildAssemblyUser,
  buildPassAUser,
  buildPassBUser,
  buildScenariosUser,
} from "../../llm/prompts/policy";
import { type CompileSteps, finalizeCompile, recordAttempt, runCompileLoop } from "../../services/policies";
import { type JobRow, setJobStage } from "../queue";

/** The model-backed steps. Each output is re-parsed with the canonical schema before use. */
export function llmCompileSteps(policyVersionId: string): CompileSteps {
  const ref = { policyVersionId };
  const reparse = <T>(stage: string, parse: () => T): T => {
    try {
      return parse();
    } catch (err) {
      throw new LlmSchemaError(stage, err instanceof Error ? err.message.slice(0, 300) : String(err));
    }
  };
  return {
    async passA({ paragraphs }) {
      const r = await structuredCall({ stage: PASS_A_STAGE, promptVersion: PASS_A_PROMPT_VERSION, schema: LlmInventorySchema, system: PASS_A_SYSTEM, user: buildPassAUser(paragraphs), effort: "high", maxTokens: 16000, ref });
      return { inventory: reparse(PASS_A_STAGE, () => InventorySchema.parse(r.data)), callId: r.callId };
    },
    async passB({ paragraphs, inventory, feedback }) {
      const r = await structuredCall({ stage: PASS_B_STAGE, promptVersion: PASS_B_PROMPT_VERSION, schema: LlmRulesSchema, system: PASS_B_SYSTEM, user: buildPassBUser({ paragraphs, inventory, feedback }), effort: "high", maxTokens: 24000, ref });
      return { rulesDoc: reparse(PASS_B_STAGE, () => RulesDocSchema.parse(llmRulesToDoc(r.data))), callId: r.callId };
    },
    async assemble({ rulesDoc, feedback }) {
      const r = await structuredCall({ stage: ASSEMBLY_STAGE, promptVersion: ASSEMBLY_PROMPT_VERSION, schema: LlmMonitorsSchema, system: ASSEMBLY_SYSTEM, user: buildAssemblyUser({ rulesDoc, feedback }), effort: "high", maxTokens: 24000, ref });
      return { monitors: reparse(ASSEMBLY_STAGE, () => MonitorsDocSchema.parse(r.data).monitors), callId: r.callId };
    },
    async proposeScenarios({ rulesDoc }) {
      const r = await structuredCall({ stage: SCENARIOS_STAGE, promptVersion: SCENARIOS_PROMPT_VERSION, schema: LlmScenariosSchema, system: SCENARIOS_SYSTEM, user: buildScenariosUser(rulesDoc), effort: "medium", maxTokens: 24000, ref });
      return { scenarios: llmScenariosToScenarios(r.data), callId: r.callId };
    },
  };
}

export async function compilePolicyVersion(policyVersionId: string, steps: CompileSteps, onStage: (stage: string, progress: number) => void = () => undefined): Promise<{ status: string; bundleHash: string; blocking: number }> {
  const db = getDb();
  const version = db.select().from(policyVersions).where(eq(policyVersions.id, policyVersionId)).get();
  if (!version) throw new Error(`policy version ${policyVersionId} not found`);
  const source = db.select().from(policySources).where(eq(policySources.id, version.policySourceId)).get();
  if (!source) throw new Error("policy source not found");
  const paragraphs = parsePolicyParagraphs(source.text);
  const requiredParagraphs = fromJson<string[]>(source.requiredParagraphsJson, []);

  try {
    const outcome = await runCompileLoop({ paragraphs, requiredParagraphs }, steps, {
      onStage,
      onAttempt: (a) => transact((tx) => recordAttempt(tx, { policyVersionId, stage: a.stage, attemptNo: a.attemptNo, input: a.input, output: a.output, issues: a.issues, llmCallId: a.callId })),
    });
    onStage("Scenario tests and preview", 92);
    const result = transact((tx) => finalizeCompile(tx, policyVersionId, outcome, "system"));
    return { status: result.status, bundleHash: result.bundleHash, blocking: result.blocking };
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    if (err.retryable) throw err; // let the queue retry a rate limit or connection error
    // A refusal, truncation, schema error, or replay miss: fail closed, visibly.
    const result = transact((tx) => finalizeCompile(tx, policyVersionId, { inventory: null, rulesDoc: null, monitors: null, compileSource: "ai", compileError: { code: err.code, message: err.message } }, "system"));
    return { status: result.status, bundleHash: result.bundleHash, blocking: result.blocking };
  }
}

export async function compilePolicy(job: JobRow): Promise<Record<string, unknown>> {
  const { policyVersionId } = fromJson<{ policyVersionId: string }>(job.payloadJson, { policyVersionId: "" });
  return compilePolicyVersion(policyVersionId, llmCompileSteps(policyVersionId), (stage, progress) => setJobStage(job.id, stage, progress));
}

/** A compile whose job died (retries exhausted, crash) must not stay COMPILING forever. */
export function compilePolicyFailed(job: JobRow, error: unknown): void {
  const { policyVersionId } = fromJson<{ policyVersionId: string }>(job.payloadJson, { policyVersionId: "" });
  const version = getDb().select().from(policyVersions).where(eq(policyVersions.id, policyVersionId)).get();
  if (!version || version.status !== "COMPILING") return;
  const code = error instanceof LlmError ? error.code : "COMPILE_ERROR";
  transact((tx) => finalizeCompile(tx, policyVersionId, { inventory: null, rulesDoc: null, monitors: null, compileSource: "ai", compileError: { code, message: error instanceof Error ? error.message : String(error) } }, "system"));
}
