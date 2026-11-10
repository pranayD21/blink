/**
 * §18.1 Compiler lifecycle through the services: the repair loop, fail-closed
 * outcomes, the bundle-hash approval, immutability, and superseding.
 *
 * The model is replaced by scripted steps; everything after a step's output is
 * the production code.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Monitor, RulesDoc } from "@/core/policy/schema";
import { getDb, transact } from "@/server/db/client";
import { compileAttempts, decisions, policyVersions } from "@/server/db/schema";
import { compilePolicyVersion, llmCompileSteps } from "@/server/jobs/handlers/compilePolicy";
import { LlmRefusal } from "@/server/llm/client";
import { getFinding } from "@/server/services/findings";
import { getCase } from "@/server/services/loaders";
import { type CompileSteps, MAX_ASSEMBLY_ATTEMPTS, approvePolicy, createPolicy, policyDetail, requestCompile, useManualFallback } from "@/server/services/policies";
import { fixturePolicyInput } from "@/server/services/seed";
import { CASE, G2, appError, dispose, findingOn, openTasks, seedAnalyzed, seedEmpty, statusOf, user } from "../helpers/db";
import { loadManualPolicy } from "../helpers/fixtures";

const manual = loadManualPolicy();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Steps that return the hand-written artifacts, with hooks to script failures. */
function scriptedSteps(overrides: Partial<CompileSteps> = {}): CompileSteps & { calls: Record<string, number>; feedback: unknown[] } {
  const calls: Record<string, number> = { passA: 0, passB: 0, assemble: 0, proposeScenarios: 0 };
  const feedback: unknown[] = [];
  const base: CompileSteps = {
    async passA() {
      return { inventory: clone(manual.inventory), callId: null };
    },
    async passB() {
      return { rulesDoc: clone(manual.rulesDoc), callId: null };
    },
    async assemble() {
      return { monitors: clone(manual.monitors), callId: null };
    },
    async proposeScenarios() {
      return { scenarios: [], callId: null };
    },
  };
  const wrap = <K extends keyof CompileSteps>(name: K): CompileSteps[K] =>
    (async (input: Parameters<CompileSteps[K]>[0]) => {
      calls[name]++;
      if ("feedback" in input && input.feedback) feedback.push(input.feedback);
      return (overrides[name] ?? base[name])(input as never);
    }) as CompileSteps[K];
  return { passA: wrap("passA"), passB: wrap("passB"), assemble: wrap("assemble"), proposeScenarios: wrap("proposeScenarios"), calls, feedback };
}

function newDraft(file: "blink-demo-policy-v1.md" | "blink-demo-policy-v1-broken.md" = "blink-demo-policy-v1.md"): string {
  const { policyVersionId } = transact((tx) => createPolicy(tx, fixturePolicyInput(file), user("dana")));
  transact((tx) => requestCompile(tx, policyVersionId, user("dana")));
  return policyVersionId;
}

const versionRow = (id: string) => getDb().select().from(policyVersions).where(eq(policyVersions.id, id)).get()!;
const blockingCodes = (id: string) => policyDetail(getDb(), id).validation!.issues.filter((i) => i.severity === "blocking").map((i) => i.code);

/** A monitor set where two transitions overlap at equal priority. */
function nondeterministic(): Monitor[] {
  const monitors = clone(manual.monitors);
  const m = monitors[0];
  const first = m.transitions.find((t) => t.from.includes("UNASSESSED") && t.result_is === "true")!;
  m.transitions.push({ ...clone(first), id: `${first.id}-dup` });
  return monitors;
}

describe("compile → validate → approve", () => {
  beforeEach(seedEmpty);

  it("a clean compile ends VALIDATED with every combination enumerated and all reviewer scenarios passing", async () => {
    const id = newDraft();
    expect(versionRow(id).status).toBe("COMPILING");
    const steps = scriptedSteps();
    const result = await compilePolicyVersion(id, steps);
    expect(result.status).toBe("VALIDATED");

    const detail = policyDetail(getDb(), id);
    expect(detail.compileSource).toBe("ai");
    expect(detail.validation!.ok).toBe(true);
    expect(detail.validation!.totals).toMatchObject({ monitors: 4, combinations: 1168 });
    expect(detail.scenarios!.reviewer).toMatchObject({ passed: 8, total: 8 });
    expect(detail.previewMd).toMatch(/R1/);
    expect(detail.attempts.map((a) => a.stage)).toEqual(["pass_a", "pass_b", "assembly", "scenarios"]);
    expect(steps.calls).toEqual({ passA: 1, passB: 1, assemble: 1, proposeScenarios: 1 });
    // VALIDATED is not ACTIVE: nothing is in force until the owner approves the hash.
    expect(versionRow(id).activatedAt).toBeNull();
  });

  it("the owner approves the exact bundle hash and the version becomes ACTIVE", async () => {
    const id = newDraft();
    await compilePolicyVersion(id, scriptedSteps());
    const hash = versionRow(id).bundleHash!;

    const wrong = appError(() => transact((tx) => approvePolicy(tx, id, "0".repeat(64), user("dana"))));
    expect(wrong.status).toBe(409);
    expect(wrong.code).toBe("BUNDLE_HASH_MISMATCH");
    expect(versionRow(id).status).toBe("VALIDATED");

    const notOwner = appError(() => transact((tx) => approvePolicy(tx, id, hash, user("jordan"))));
    expect(notOwner.status).toBe(403);

    transact((tx) => approvePolicy(tx, id, hash, user("dana")));
    expect(versionRow(id)).toMatchObject({ status: "ACTIVE", approvedBy: "user_dana" });
    expect(getCase(getDb(), CASE).activePolicyVersionId).toBe(id);
  });

  it("an artifact changed after validation no longer matches its hash: approval is refused", async () => {
    const id = newDraft();
    await compilePolicyVersion(id, scriptedSteps());
    const row = versionRow(id);
    const rules = JSON.parse(row.rulesJson!) as RulesDoc;
    rules.rules[0].severity = "low";
    getDb().update(policyVersions).set({ rulesJson: JSON.stringify(rules) }).where(eq(policyVersions.id, id)).run();
    const err = appError(() => transact((tx) => approvePolicy(tx, id, row.bundleHash!, user("dana"))));
    expect(err.status).toBe(409);
    expect(err.code).toBe("BUNDLE_HASH_MISMATCH");
  });

  it("an ACTIVE version is immutable", async () => {
    const id = newDraft();
    await compilePolicyVersion(id, scriptedSteps());
    transact((tx) => approvePolicy(tx, id, versionRow(id).bundleHash!, user("dana")));
    expect(appError(() => transact((tx) => requestCompile(tx, id, user("dana")))).status).toBe(422);
    const fallback = appError(() => transact((tx) => useManualFallback(tx, id, user("dana"))));
    expect(fallback.status).toBe(422);
    expect(fallback.code).toBe("POLICY_IMMUTABLE");
  });

  it("only the policy owner can create or compile a policy", () => {
    expect(appError(() => transact((tx) => createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1.md"), user("marcus")))).status).toBe(403);
    const { policyVersionId } = transact((tx) => createPolicy(tx, fixturePolicyInput("blink-demo-policy-v1.md"), user("dana")));
    expect(appError(() => transact((tx) => requestCompile(tx, policyVersionId, user("marcus")))).status).toBe(403);
  });
});

describe("repair loop (§8.7)", () => {
  beforeEach(seedEmpty);

  it("feeds validator issues back to assembly and succeeds on the second attempt", async () => {
    const id = newDraft();
    let n = 0;
    const steps = scriptedSteps({
      async assemble() {
        n++;
        return { monitors: n === 1 ? nondeterministic() : clone(manual.monitors), callId: null };
      },
    });
    const result = await compilePolicyVersion(id, steps);
    expect(result.status).toBe("VALIDATED");
    expect(steps.calls.assemble).toBe(2);
    const fed = steps.feedback[0] as { issues: { code: string; counterexample?: unknown }[] };
    expect(fed.issues.map((i) => i.code)).toContain("NONDETERMINISTIC");
    expect(fed.issues.find((i) => i.code === "NONDETERMINISTIC")!.counterexample).toBeDefined();
    const attempts = getDb().select().from(compileAttempts).where(eq(compileAttempts.policyVersionId, id)).all();
    expect(attempts.filter((a) => a.stage === "assembly")).toHaveLength(2);
  });

  it("repair budget exhausted → COMPILE_FAILED, and approve returns 422", async () => {
    const id = newDraft();
    const steps = scriptedSteps({
      async assemble() {
        return { monitors: nondeterministic(), callId: null };
      },
    });
    const result = await compilePolicyVersion(id, steps);
    expect(result.status).toBe("COMPILE_FAILED");
    expect(steps.calls.assemble).toBe(MAX_ASSEMBLY_ATTEMPTS);
    // No scenarios are requested for a policy that cannot validate.
    expect(steps.calls.proposeScenarios).toBe(0);
    expect(blockingCodes(id)).toContain("NONDETERMINISTIC");

    const row = versionRow(id);
    const err = appError(() => transact((tx) => approvePolicy(tx, id, row.bundleHash!, user("dana"))));
    expect(err.status).toBe(422);
    expect(versionRow(id).status).toBe("COMPILE_FAILED");
  });

  it("a rule-level blocker goes back to pass B, at most twice in total", async () => {
    const id = newDraft();
    const badRules = (): RulesDoc => {
      const doc = clone(manual.rulesDoc);
      doc.rules[0].guard.nodes = doc.rules[0].guard.nodes.map((node) => (node.op === "pred" ? { ...node, name: "expert_is_lying" } : node)) as typeof doc.rules[0]["guard"]["nodes"];
      return doc;
    };
    const steps = scriptedSteps({
      async passB() {
        return { rulesDoc: badRules(), callId: null };
      },
    });
    const result = await compilePolicyVersion(id, steps);
    expect(result.status).toBe("COMPILE_FAILED");
    expect(steps.calls.passB).toBe(2);
    expect(blockingCodes(id)).toContain("UNKNOWN_PREDICATE");
  });

  it("the broken policy fails closed: a dropped required clause blocks even a graceful compile", async () => {
    const id = newDraft("blink-demo-policy-v1-broken.md");
    // The model "gracefully" declares P3 unsupported and compiles everything else.
    const p3Clauses = manual.inventory.clauses.filter((c) => c.paragraph === "P3").map((c) => c.clause_id);
    const steps = scriptedSteps({
      async passB() {
        const doc = clone(manual.rulesDoc);
        const dropped = doc.rules.filter((r) => r.source_clause_ids.some((c) => p3Clauses.includes(c)));
        doc.rules = doc.rules.filter((r) => !dropped.includes(r));
        for (const clause of p3Clauses) doc.unsupported_clauses.push({ clause_id: clause, reason: "automatic approval and mood are outside the vocabulary" });
        return { rulesDoc: doc, callId: null };
      },
      async assemble({ rulesDoc }) {
        const ids = new Set(rulesDoc.rules.map((r) => r.rule_id));
        return { monitors: clone(manual.monitors).filter((m) => ids.has(m.rule_id)), callId: null };
      },
    });
    const result = await compilePolicyVersion(id, steps);
    expect(result.status).toBe("COMPILE_FAILED");
    expect(blockingCodes(id)).toContain("CLAUSE_DROPPED");
    const err = appError(() => transact((tx) => approvePolicy(tx, id, versionRow(id).bundleHash!, user("dana"))));
    expect(err.status).toBe(422);
  });

  it("a monitor that proposes APPROVE is rejected, never defaulted", async () => {
    const id = newDraft();
    const steps = scriptedSteps({
      async assemble() {
        const monitors = clone(manual.monitors) as unknown as { transitions: { effects: string[] }[] }[];
        monitors[0].transitions[0].effects.push("APPROVE");
        return { monitors: monitors as unknown as Monitor[], callId: null };
      },
    });
    const result = await compilePolicyVersion(id, steps);
    expect(result.status).toBe("COMPILE_FAILED");
    expect(blockingCodes(id)).toContain("FORBIDDEN_EFFECT");
  });

  it("a model refusal ends COMPILE_FAILED with the reason shown, not a silent retry", async () => {
    const id = newDraft();
    const steps = scriptedSteps({
      async passB() {
        throw new LlmRefusal("policy_pass_b", { category: "other", explanation: null });
      },
    });
    const result = await compilePolicyVersion(id, steps);
    expect(result.status).toBe("COMPILE_FAILED");
    expect(policyDetail(getDb(), id).validation!.compileError).toMatchObject({ code: "LLM_REFUSAL" });
  });

  it("replay mode with no recording never reaches the network: COMPILE_FAILED with LLM_REPLAY_MISS", async () => {
    const text = "# Unrecorded policy\n\n[P1] Compliance must review any statement about the weather at a covered issuer's headquarters.\n";
    const { policyVersionId } = transact((tx) => createPolicy(tx, { title: "Unrecorded policy", text, requiredParagraphs: [] }, user("dana")));
    transact((tx) => requestCompile(tx, policyVersionId, user("dana")));
    const result = await compilePolicyVersion(policyVersionId, llmCompileSteps(policyVersionId));
    expect(result.status).toBe("COMPILE_FAILED");
    expect(policyDetail(getDb(), policyVersionId).validation!.compileError).toMatchObject({ code: "LLM_REPLAY_MISS" });
  });
});

describe("manual fallback and superseding (§8.9, §8.1)", () => {
  beforeEach(seedAnalyzed);

  it("the manual fallback passes the same gate and is labeled as manual", () => {
    const active = getDb().select().from(policyVersions).where(eq(policyVersions.status, "ACTIVE")).get()!;
    expect(active.compileSource).toBe("manual");
    const detail = policyDetail(getDb(), active.id);
    expect(detail.validation!.totals.combinations).toBe(1168);
    expect(detail.scenarios!.reviewer).toMatchObject({ passed: 8, total: 8 });
    // P8 (call-count limits) is outside the vocabulary and is shown as unsupported, not silently dropped.
    expect(detail.rulesDoc!.unsupported_clauses.map((u) => u.clause_id)).toEqual(["C10", "C11"]);
  });

  it("activating a new version supersedes the old one and reopens decisions made under it", async () => {
    const old = getDb().select().from(policyVersions).where(eq(policyVersions.status, "ACTIVE")).get()!;
    const f2 = findingOn(G2);
    const { decisionId } = dispose(f2.id, "restricted_exclude", "marcus");

    // A new version whose rules differ slightly (so its bundle hash differs).
    const id = newDraft();
    const steps = scriptedSteps({
      async passB() {
        const doc = clone(manual.rulesDoc);
        doc.rules[0].intent = `${doc.rules[0].intent} (reworded)`;
        return { rulesDoc: doc, callId: null };
      },
    });
    expect((await compilePolicyVersion(id, steps)).status).toBe("VALIDATED");
    const result = transact((tx) => approvePolicy(tx, id, versionRow(id).bundleHash!, user("dana")));

    expect(result.superseded).toEqual([old.id]);
    expect(result.casesReevaluated).toContain(CASE);
    expect(versionRow(old.id).status).toBe("SUPERSEDED");
    expect(getCase(getDb(), CASE).activePolicyVersionId).toBe(id);

    const decision = getDb().select().from(decisions).where(eq(decisions.id, decisionId!)).get()!;
    expect(decision.stale).toBe(true);
    expect(decision.staleReason).toMatch(/policy/);
    expect(getFinding(getDb(), f2.id).state).toBe("REVIEW_REQUIRED");
    expect(openTasks(f2.id, "review")).toHaveLength(1);
    expect(statusOf()).toBe("IN_REVIEW");
  });
});
