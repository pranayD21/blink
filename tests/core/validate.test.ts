import { describe, expect, it } from "vitest";
import { guardToEnglish, decompilePolicy } from "@/core/policy/decompile";
import { enumerateMonitor, forEachAssignment } from "@/core/policy/enumerate";
import { runScenarios, scenarioIssues } from "@/core/policy/scenarios";
import { type FlatGuard, type Monitor, RuleSchema, buildGuardTree, collectPredicates, flattenGuard, llmGuardToFlat, parsePolicyParagraphs } from "@/core/policy/schema";
import { type IssueCode, type ValidationReport, validatePolicy } from "@/core/policy/validate";
import { loadManualPolicy, loadScenarios, readFixture } from "../helpers/fixtures";

const policy = loadManualPolicy();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const source = { paragraphs: policy.paragraphs, requiredParagraphs: policy.requiredParagraphs };

function validate(mutate?: (doc: { rules: typeof policy.rulesDoc; monitors: Monitor[]; inventory: typeof policy.inventory }) => void, withSource = true): ValidationReport {
  const doc = { rules: clone(policy.rulesDoc), monitors: clone(policy.monitors), inventory: clone(policy.inventory) };
  mutate?.(doc);
  return validatePolicy({ source: withSource ? source : null, inventory: withSource ? doc.inventory : null, rulesDoc: doc.rules, monitorsDoc: { monitors: doc.monitors } });
}
const blockingCodes = (r: ValidationReport): IssueCode[] => r.issues.filter((i) => i.severity === "blocking").map((i) => i.code);

describe("guard trees", () => {
  const flat = (nodes: FlatGuard["nodes"], root = "g"): FlatGuard => ({ root, nodes });
  const p = (id: string, name = "about_covered_issuer") => ({ id, op: "pred" as const, name });

  it("rebuilds a valid tree", () => {
    const built = buildGuardTree(flat([{ id: "g", op: "and", children: ["a", "n"] }, p("a"), { id: "n", op: "not", children: ["b"] }, p("b", "public_match_verified")]));
    expect(built).toEqual({ ok: true, tree: { op: "and", args: [{ op: "pred", name: "about_covered_issuer" }, { op: "not", arg: { op: "pred", name: "public_match_verified" } }] } });
  });

  it("rejects a cycle", () => {
    const built = buildGuardTree(flat([{ id: "g", op: "and", children: ["a", "h"] }, p("a"), { id: "h", op: "or", children: ["a", "g"] }]));
    expect(built.ok).toBe(false);
    expect(!built.ok && built.reason).toMatch(/cycle/);
  });

  it("rejects dangling ids, bad arity, orphans, and a missing root", () => {
    expect(buildGuardTree(flat([{ id: "g", op: "and", children: ["a", "zz"] }, p("a")])).ok).toBe(false);
    expect(buildGuardTree(flat([{ id: "g", op: "and", children: ["a"] }, p("a")])).ok).toBe(false);
    expect(buildGuardTree(flat([{ id: "g", op: "not", children: ["a", "b"] }, p("a"), p("b")])).ok).toBe(false);
    expect(buildGuardTree(flat([p("g"), p("orphan")])).ok).toBe(false);
    expect(buildGuardTree(flat([p("a")], "nope")).ok).toBe(false);
    expect(buildGuardTree(flat([{ id: "g", op: "pred" }])).ok).toBe(false);
  });

  it("caps depth at 4", () => {
    const depth4 = flat([{ id: "g", op: "and", children: ["a", "o"] }, p("a"), { id: "o", op: "or", children: ["b", "n"] }, p("b"), { id: "n", op: "not", children: ["c"] }, p("c")]);
    expect(buildGuardTree(depth4).ok).toBe(true);
    const depth5 = flat([{ id: "g", op: "and", children: ["a", "o"] }, p("a"), { id: "o", op: "or", children: ["b", "n"] }, p("b"), { id: "n", op: "not", children: ["m"] }, { id: "m", op: "not", children: ["c"] }, p("c")]);
    const built = buildGuardTree(depth5);
    expect(!built.ok && built.reason).toMatch(/deeper/);
  });

  it("round-trips through the flat form and collects predicates once", () => {
    const tree = policy.rules.get("R4")!.guard;
    expect(buildGuardTree(flattenGuard(tree))).toEqual({ ok: true, tree });
    expect(collectPredicates(tree).map((u) => u.key)).toEqual([
      "expert_recent_issuer_employee(months=12)",
      "about_covered_issuer",
      "company_specific_operating_metric",
      "current_or_unreported_period",
      "public_match_verified",
    ]);
  });

  it("converts the model's flat form (params as pairs, nulls for absent members)", () => {
    const converted = llmGuardToFlat({
      root: "g",
      nodes: [
        { id: "g", op: "and", name: null, params: [], children: ["a", "b"] },
        { id: "a", op: "pred", name: "expert_recent_issuer_employee", params: [{ key: "months", value: 12 }], children: [] },
        { id: "b", op: "pred", name: "about_covered_issuer", params: [], children: [] },
      ],
    });
    expect(buildGuardTree(converted)).toEqual({ ok: true, tree: { op: "and", args: [{ op: "pred", name: "expert_recent_issuer_employee", params: { months: 12 } }, { op: "pred", name: "about_covered_issuer" }] } });
  });

  it("there is no string guard form: code cannot be smuggled in", () => {
    const rule = clone(policy.rulesDoc.rules[0]) as unknown as Record<string, unknown>;
    for (const guard of ["process.exit()", "__import__('os').system('rm -rf /')"]) {
      expect(RuleSchema.safeParse({ ...rule, guard }).success).toBe(false);
    }
    expect(validate((d) => ((d.rules.rules[0] as unknown as { guard: unknown }).guard = "process.exit()"))).toMatchObject({ ok: false });
    expect(blockingCodes(validate((d) => ((d.rules.rules[0] as unknown as { guard: unknown }).guard = "__import__('os')")))).toContain("SCHEMA_INVALID");
  });
});

describe("the manual fallback policy", () => {
  const report = validate();

  it("validates with no blocking issue", () => {
    expect(report.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("enumerates 1,168 evidence combinations across 4 monitors, all deterministic", () => {
    expect(report.enumeration.map((e) => [e.rule_id, e.combinations])).toEqual([["R1", 64], ["R2", 16], ["R3", 64], ["R4", 1024]]);
    expect(report.totals).toEqual({ monitors: 4, combinations: 1168, deterministic: true, indeterminate_handled: true });
  });

  it("counts guard outcomes exactly", () => {
    // and(a, b, c): true only when all three are supported (1); false when any is refuted (64 − 27 = 37).
    expect(report.enumeration[0].outcomes).toEqual({ true: 1, false: 37, indeterminate: 26 });
    expect(report.enumeration[1].outcomes).toEqual({ true: 1, false: 7, indeterminate: 8 });
    // R4 = and(p1..p4, not(p5)): true when p1..p4 supported and p5 refuted.
    expect(report.enumeration[3].outcomes.true).toBe(1);
    const sum = Object.values(report.enumeration[3].outcomes).reduce((a, b) => a + b, 0);
    expect(sum).toBe(1024);
  });

  it("reports coverage and reachability", () => {
    for (const e of report.enumeration) {
      expect(e.unreachable_states).toEqual([]);
      expect(e.coverage.total).toBe(e.reachable_states.length * 2 * 3);
      // Nothing leaves REVIEW_REQUIRED: only a person can close review.
      expect(e.coverage.unhandled.every((u) => u.state === "REVIEW_REQUIRED")).toBe(true);
    }
  });

  it("passes every reviewer-authored scenario", () => {
    const scenarios = loadScenarios();
    const result = runScenarios(scenarios, { rules: policy.rules, monitors: policy.monitors, inventory: policy.inventory, paragraphs: policy.paragraphs }, "reviewer");
    expect(result.results.filter((r) => !r.pass).map((r) => [r.name, r.failures])).toEqual([]);
    expect(result).toMatchObject({ total: 8, passed: 8, failed: 0 });
    expect(scenarioIssues(result)).toEqual([]);
  });

  it("covers every policy paragraph and lists P8 and P9 as unsupported", () => {
    expect(report.issues.filter((i) => i.code === "PARAGRAPH_UNCOVERED")).toEqual([]);
    expect(policy.rulesDoc.unsupported_clauses.map((u) => u.clause_id)).toEqual(["C10", "C11"]);
  });
});

describe("validator rejections (each must be rejected, never defaulted)", () => {
  it("invalid state endpoint → BAD_ENDPOINT", () => {
    expect(blockingCodes(validate((d) => (d.monitors[0].transitions[0].to = "CLEARED")))).toContain("BAD_ENDPOINT");
    expect(blockingCodes(validate((d) => (d.monitors[0].transitions[0].from = ["NOWHERE"])))).toContain("BAD_ENDPOINT");
    expect(blockingCodes(validate((d) => d.monitors[0].states.push("APPROVED")))).toContain("BAD_ENDPOINT");
  });

  it("duplicate ids → DUPLICATE_ID", () => {
    expect(blockingCodes(validate((d) => (d.monitors[0].transitions[1].id = d.monitors[0].transitions[0].id)))).toContain("DUPLICATE_ID");
    expect(blockingCodes(validate((d) => (d.rules.rules[1].rule_id = "R1")))).toContain("DUPLICATE_ID");
    expect(blockingCodes(validate((d) => (d.monitors[1].monitor_id = "M1")))).toContain("DUPLICATE_ID");
  });

  it.each(["APPROVE", "RELEASE", "CLEAR"])("%s effect → FORBIDDEN_EFFECT", (effect) => {
    const report = validate((d) => d.monitors[0].transitions[4].effects.push(effect));
    expect(blockingCodes(report)).toContain("FORBIDDEN_EFFECT");
    expect(report.ok).toBe(false);
  });

  it("two transitions overlapping at equal priority → NONDETERMINISTIC with a counterexample", () => {
    const report = validate((d) => d.monitors[0].transitions.push({ ...d.monitors[0].transitions[0], id: "M1-DUP", to: "NOT_TRIGGERED", effects: ["AUDIT_ONLY"] }));
    expect(blockingCodes(report)).toContain("NONDETERMINISTIC");
    const cx = report.enumeration[0].determinism.counterexamples[0];
    expect(cx.transitions.sort()).toEqual(["M1-DUP", "M1-T1"]);
    expect(cx.result).toBe("true");
    expect(cx.assignment).toEqual({ about_covered_issuer: "supported", company_specific_operating_metric: "supported", internal_source_claimed: "supported" });
  });

  it("an overlap resolved by priority is deterministic", () => {
    const report = validate((d) => d.monitors[0].transitions.push({ ...d.monitors[0].transitions[0], id: "M1-HI", priority: 5 }));
    expect(blockingCodes(report)).not.toContain("NONDETERMINISTIC");
  });

  it("unknown predicate expert_is_lying → UNKNOWN_PREDICATE", () => {
    const report = validate((d) => (d.rules.rules[0].guard.nodes[1].name = "expert_is_lying"));
    expect(blockingCodes(report)).toContain("UNKNOWN_PREDICATE");
    // Nothing sound to enumerate for that rule.
    expect(report.enumeration.map((e) => e.rule_id)).toEqual(["R2", "R3", "R4"]);
  });

  it("guard with a cycle in flat form → GUARD_MALFORMED", () => {
    expect(blockingCodes(validate((d) => (d.rules.rules[1].guard.nodes[0].children = ["a", "g"])))).toContain("GUARD_MALFORMED");
  });

  it("bad param → BAD_PARAM", () => {
    expect(blockingCodes(validate((d) => (d.rules.rules[3].guard.nodes[1].params = { months: 99 })))).toContain("BAD_PARAM");
    expect(blockingCodes(validate((d) => delete d.rules.rules[3].guard.nodes[1].params))).toContain("BAD_PARAM");
  });

  it("no handler for indeterminate → INDETERMINATE_UNHANDLED", () => {
    const report = validate((d) => (d.monitors[0].transitions = d.monitors[0].transitions.filter((t) => t.result_is !== "indeterminate")));
    expect(blockingCodes(report)).toContain("INDETERMINATE_UNHANDLED");
  });

  it("more than 8 predicates → TOO_MANY_PREDICATES", () => {
    const names = ["about_covered_issuer", "company_specific_operating_metric", "nonpublic_corporate_event", "current_or_unreported_period", "internal_source_claimed", "post_employment_access", "confidentiality_signal_present", "public_match_verified", "analyst_solicited"];
    const report = validate((d) => {
      d.rules.rules[0].guard = {
        root: "g",
        nodes: [
          { id: "g", op: "or", children: ["x", "y"] },
          { id: "x", op: "and", children: ["p0", "p1", "p2", "p3", "p4"] },
          { id: "y", op: "and", children: ["p5", "p6", "p7", "p8"] },
          ...names.map((name, i) => ({ id: `p${i}`, op: "pred" as const, name })),
        ],
      };
    });
    expect(blockingCodes(report)).toContain("TOO_MANY_PREDICATES");
  });

  it("an actionable clause in no rule → CLAUSE_DROPPED", () => {
    // Drop the P6 exception from both rules without listing it as unsupported.
    const report = validate((d) => d.rules.rules.forEach((r) => (r.exception_clause_ids = r.exception_clause_ids.filter((c) => c !== "C8"))));
    const dropped = report.issues.filter((i) => i.code === "CLAUSE_DROPPED");
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ severity: "blocking", clause_id: "C8" });
  });

  it("a required paragraph left unsupported → CLAUSE_DROPPED (the broken-policy path)", () => {
    const report = validate((d) => {
      d.rules.rules = d.rules.rules.filter((r) => r.rule_id !== "R2");
      d.monitors = d.monitors.filter((m) => m.rule_id !== "R2");
      d.rules.unsupported_clauses.push({ clause_id: "C3", reason: "automatic approval is outside the vocabulary" });
    });
    expect(report.ok).toBe(false);
    expect(report.issues.filter((i) => i.code === "CLAUSE_DROPPED").map((i) => i.paragraph)).toEqual(["P3"]);
  });

  it("a required paragraph that no rule automates → CLAUSE_DROPPED even if nothing is listed", () => {
    const report = validate((d) => {
      d.inventory.clauses.find((c) => c.clause_id === "C3")!.kind = "discretion";
      d.rules.rules = d.rules.rules.filter((r) => r.rule_id !== "R2");
      d.monitors = d.monitors.filter((m) => m.rule_id !== "R2");
    });
    expect(report.issues.filter((i) => i.code === "CLAUSE_DROPPED").map((i) => i.paragraph)).toEqual(["P3"]);
  });

  it("a clause quoting text that is not in the policy → CLAUSE_NOT_IN_SOURCE", () => {
    const report = validate((d) => (d.inventory.clauses[1].verbatim = "Compliance may approve any call it likes."));
    expect(report.issues.find((i) => i.code === "CLAUSE_NOT_IN_SOURCE")).toMatchObject({ severity: "blocking", clause_id: "C2" });
  });

  it("an uncovered paragraph → PARAGRAPH_UNCOVERED (warning)", () => {
    const report = validate((d) => (d.inventory.clauses = d.inventory.clauses.filter((c) => c.clause_id !== "C1")));
    expect(report.issues.find((i) => i.code === "PARAGRAPH_UNCOVERED")).toMatchObject({ severity: "warning", paragraph: "P1" });
    expect(report.ok).toBe(true);
  });

  it("an unreachable declared state → UNREACHABLE_STATE (warning)", () => {
    const report = validate((d) => d.monitors[0].states.push("ESCALATION_REQUESTED"));
    expect(report.issues.find((i) => i.code === "UNREACHABLE_STATE")).toMatchObject({ severity: "warning", monitor_id: "M1" });
    expect(report.ok).toBe(true);
  });

  it("a rule citing an unknown clause, or a rule with no monitor, is blocked", () => {
    expect(blockingCodes(validate((d) => d.rules.rules[0].source_clause_ids.push("C99")))).toContain("CLAUSE_REF_UNKNOWN");
    expect(blockingCodes(validate((d) => d.monitors.pop()))).toContain("MONITOR_RULE_MISMATCH");
    expect(blockingCodes(validate((d) => (d.monitors[0].rule_id = "R9")))).toContain("MONITOR_RULE_MISMATCH");
  });

  it("a monitor that drops its rule's escalation → RULE_EFFECT_MISMATCH", () => {
    const report = validate((d) => d.monitors[1].transitions.forEach((t) => (t.effects = t.effects.filter((e) => e !== "REQUEST_ESCALATION"))));
    expect(blockingCodes(report)).toContain("RULE_EFFECT_MISMATCH");
  });

  it("malformed input → SCHEMA_INVALID, with no enumeration attempted", () => {
    const report = validatePolicy({ rulesDoc: { rules: "nope" }, monitorsDoc: { monitors: [{ monitor_id: 1 }] } });
    expect(new Set(blockingCodes(report))).toEqual(new Set(["SCHEMA_INVALID"]));
    expect(report.enumeration).toEqual([]);
    expect(report.totals.deterministic).toBe(false);
  });

  it("a failing reviewer scenario → SCENARIO_FAILED (blocking); an AI-proposed one only warns", () => {
    const monitors = clone(policy.monitors);
    monitors[0].transitions.find((t) => t.result_is === "true" && t.event === "CLAIM_EVALUATED")!.to = "NOT_TRIGGERED";
    const reviewer = runScenarios(loadScenarios(), { rules: policy.rules, monitors, inventory: policy.inventory, paragraphs: policy.paragraphs }, "reviewer");
    expect(reviewer.failed).toBeGreaterThan(0);
    expect(scenarioIssues(reviewer).every((i) => i.code === "SCENARIO_FAILED" && i.severity === "blocking")).toBe(true);
    const ai = runScenarios(loadScenarios(), { rules: policy.rules, monitors, inventory: policy.inventory, paragraphs: policy.paragraphs }, "ai");
    expect(scenarioIssues(ai).every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("enumeration", () => {
  it("visits 4^k assignments, each exactly once", () => {
    const seen = new Set<string>();
    const total = forEachAssignment(["a", "b", "c"], (x) => seen.add(JSON.stringify(x)));
    expect(total).toBe(64);
    expect(seen.size).toBe(64);
    expect(forEachAssignment([], () => undefined)).toBe(1);
  });

  it("handles the 8-predicate ceiling (65,536 combinations)", () => {
    const names = ["about_covered_issuer", "company_specific_operating_metric", "nonpublic_corporate_event", "current_or_unreported_period", "internal_source_claimed", "post_employment_access", "confidentiality_signal_present", "public_match_verified"];
    const built = buildGuardTree({ root: "g", nodes: [{ id: "g", op: "or", children: ["x", "y"] }, { id: "x", op: "and", children: ["p0", "p1", "p2", "p3"] }, { id: "y", op: "and", children: ["p4", "p5", "p6", "p7"] }, ...names.map((name, i) => ({ id: `p${i}`, op: "pred" as const, name }))] });
    if (!built.ok) throw new Error(built.reason);
    const report = enumerateMonitor(policy.monitors[0], built.tree);
    expect(report.combinations).toBe(65536);
    expect(report.determinism.pass).toBe(true);
  });
});

describe("policy paragraphs", () => {
  it("keeps [P#] markers from the source", () => {
    expect(policy.paragraphs.map((p) => p.id)).toEqual(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]);
    expect(policy.paragraphs[7].text).toBe("Analysts may not hold more than three calls with the same expert in a calendar quarter.");
    for (const p of policy.paragraphs) expect(policy.sourceText.slice(p.start, p.end)).toBe(p.text);
  });

  it("numbers paragraphs when the text has no markers, skipping headings", () => {
    const parsed = parsePolicyParagraphs("# Title\n\nFirst rule.\nstill first.\n\nSecond rule.\n");
    expect(parsed.map((p) => [p.id, p.text])).toEqual([["P1", "First rule.\nstill first."], ["P2", "Second rule."]]);
  });

  it("the broken fixture differs only in P3", () => {
    const broken = parsePolicyParagraphs(readFixture("policy", "blink-demo-policy-v1-broken.md"));
    const changed = broken.filter((p, i) => p.text !== policy.paragraphs[i].text).map((p) => p.id);
    expect(changed).toEqual(["P3"]);
    expect(broken[2].text).toContain("automatically approve");
  });
});

describe("deterministic preview", () => {
  it("renders guards in English", () => {
    expect(guardToEnglish(policy.rules.get("R1")!.guard)).toBe(
      "the statement is about the covered issuer AND the statement gives an operating figure for one company AND the expert credits an internal company source",
    );
    expect(guardToEnglish(policy.rules.get("R4")!.guard)).toContain("in the past 12 months AND");
    expect(guardToEnglish(policy.rules.get("R4")!.guard)).toMatch(/AND NOT \(the information matches a verified public source\)$/);
  });

  it("is stable and lists rules, source quotes, transitions, enumeration, and unsupported clauses", () => {
    const report = validate();
    const input = { title: "Blink Demo Capital — Expert Call Policy", inventory: policy.inventory, rulesDoc: policy.rulesDoc, monitors: policy.monitors, enumeration: report.enumeration };
    const md = decompilePolicy(input);
    expect(decompilePolicy(input)).toBe(md);
    for (const text of ["## Rule R1", "## Rule R4", "| M2-T1 |", "REQUEST_ESCALATION", "1,024 evidence combinations", "Not automated — reviewer must apply manually", "Analysts may not hold more than three calls", "Deterministic: yes"]) {
      expect(md).toContain(text);
    }
  });
});
