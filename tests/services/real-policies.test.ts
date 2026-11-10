/**
 * The three published firm policies (Task 36) and their compiled bundles.
 * Files only; no database, no network.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePolicyParagraphs } from "@/core/policy/schema";
import { REAL_POLICIES, type RealPolicyBundle, loadRealPolicy, readRealPolicyBundle, realPolicyText } from "@/server/eval/real";
import { sha256Hex } from "@/core/deps/hash";

describe("real policies", () => {
  it("are the three chosen on 2026-11-10", () => {
    expect(REAL_POLICIES.map((p) => p.name)).toEqual(["oaktree", "sage-rock", "tcw"]);
  });

  it.each(REAL_POLICIES.map((p) => p.name))("%s: names its filing, and every required paragraph is in the text", (name) => {
    const policy = REAL_POLICIES.find((p) => p.name === name)!;
    const text = realPolicyText(name);
    expect(text).toMatch(/^- Filing: https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\/\d+\/\S+\.htm$/m);
    const ids = parsePolicyParagraphs(text).map((p) => p.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of policy.requiredParagraphs) expect(ids).toContain(id);
  });

  it.each(REAL_POLICIES.map((p) => p.name))("%s: the compiled bundle was made from the current text", (name) => {
    const bundle = readRealPolicyBundle(name);
    expect(bundle.name).toBe(name);
    expect(bundle.sourceTextHash).toBe(sha256Hex(realPolicyText(name).replace(/\r\n?/g, "\n")));
    expect(["VALIDATED", "COMPILE_FAILED"]).toContain(bundle.status);
  });

  it.each(REAL_POLICIES.map((p) => p.name))("%s: loads when it validated, and otherwise refuses by name", (name) => {
    const bundle = readRealPolicyBundle(name);
    if (bundle.status === "VALIDATED") {
      const policy = loadRealPolicy(name);
      expect(policy.rules.size).toBeGreaterThan(0);
      expect(policy.monitors.map((m) => m.rule_id).sort()).toEqual([...policy.rules.keys()].sort());
    } else {
      expect(() => loadRealPolicy(name)).toThrow(new RegExp(`"${name}"`));
    }
  });

  it("an unknown policy name is refused", () => {
    expect(() => loadRealPolicy("nope")).toThrow(/unknown real policy "nope"/);
  });

  it("a bundle whose text has changed since it was compiled is refused", () => {
    const name = REAL_POLICIES[0].name;
    const bundle = readRealPolicyBundle(name);
    expect(() => loadRealPolicy(name, { bundle: { ...bundle, sourceTextHash: "0".repeat(64) } })).toThrow(/compiled from different text/);
  });

  it("a validated bundle loads with no option and no coverage gaps", () => {
    const name = "sage-rock";
    const bundle = readRealPolicyBundle(name);
    const validated: RealPolicyBundle = { ...bundle, status: "VALIDATED", issues: bundle.issues.filter((i) => i.severity !== "blocking") };
    const policy = loadRealPolicy(name, { bundle: validated });
    expect(policy.coverageGaps).toEqual([]);
    expect([...policy.rules.keys()]).toEqual(bundle.rulesDoc!.rules.map((r) => r.rule_id));
    expect(policy.monitors).toHaveLength(bundle.monitors.length);
  });

  it.each([
    ["oaktree", 4, 10],
    ["sage-rock", 5, 7],
    ["tcw", 3, 10],
  ] as const)("%s: with allowCoverageGaps, loads its %i rules and names its %i coverage gaps", (name, rules, gaps) => {
    const bundle = readRealPolicyBundle(name);
    expect(bundle.status).toBe("COMPILE_FAILED");
    expect(() => loadRealPolicy(name)).toThrow(/allowCoverageGaps/);
    const policy = loadRealPolicy(name, { allowCoverageGaps: true });
    expect(policy.rules.size).toBe(rules);
    expect(policy.monitors).toHaveLength(rules);
    expect(policy.coverageGaps).toHaveLength(gaps);
    expect(policy.coverageGaps.every((g) => g.startsWith("CLAUSE_DROPPED: "))).toBe(true);
  });

  it("with allowCoverageGaps, any blocking issue that is not about coverage still refuses the policy", () => {
    const name = "oaktree";
    const bundle = readRealPolicyBundle(name);
    const broken: RealPolicyBundle = { ...bundle, issues: [...bundle.issues, { code: "INDETERMINATE_UNHANDLED", severity: "blocking", message: "monitor M1 has no transition for an indeterminate result" }] };
    expect(() => loadRealPolicy(name, { allowCoverageGaps: true, bundle: broken })).toThrow(/real policy "oaktree" did not validate \(COMPILE_FAILED\): CLAUSE_DROPPED, INDETERMINATE_UNHANDLED$/);
    const noCompile: RealPolicyBundle = { ...bundle, compileError: { code: "LLM_REPLAY_MISS", message: "no recording" } };
    expect(() => loadRealPolicy(name, { allowCoverageGaps: true, bundle: noCompile })).toThrow(/LLM_REPLAY_MISS/);
  });

  it("the bundle files are plain JSON that the loader reads", () => {
    for (const p of REAL_POLICIES) expect(() => JSON.parse(readFileSync(`fixtures/real/policies/${p.name}.compiled.json`, "utf8"))).not.toThrow();
  });
});
