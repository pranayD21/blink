/**
 * §18.1 Runtime, through the services and the database: analysis produces the
 * gold findings, replays create nothing new, and a conflict always opens review.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { statePath } from "@/core/workflow/finding";
import { getDb, transact } from "@/server/db/client";
import { findings, monitorEvaluations, monitorInstances, tasks } from "@/server/db/schema";
import { reevaluateCase } from "@/server/services/evaluation";
import { latestRun } from "@/server/services/analysis";
import { loadCurrentClaims, loadPublicMatch } from "@/server/services/loaders";
import { loadWorkspace } from "@/server/services/workspace";
import { CASE, G1, G2, G3, analyzeFixtureCase, findingOn, findingsOf, openTasks, seedAnalyzed, statusOf, user } from "../helpers/db";
import { loadVariants } from "../helpers/fixtures";

const rulesOf = (caseId: string, claimKey: string) =>
  getDb()
    .select()
    .from(monitorInstances)
    .where(eq(monitorInstances.caseId, caseId))
    .all()
    .filter((i) => i.claimLogicalKey === claimKey);

describe("analysis of the Halvorsen case (gold claims, manual policy)", () => {
  beforeAll(seedAnalyzed);

  it("opens the three gold findings as F1–F3, in call order, and leaves the case in review", () => {
    const policy = findingsOf().filter((f) => f.origin === "policy").sort((a, b) => a.seqNo - b.seqNo);
    expect(policy.map((f) => [f.seqNo, f.claimLogicalKey, f.state])).toEqual([
      [1, G1, "REVIEW_REQUIRED"],
      [2, G2, "REVIEW_REQUIRED"],
      [3, G3, "NEEDS_CONTEXT"],
    ]);
    expect(statusOf()).toBe("IN_REVIEW");
  });

  it("G1: rules R1, R2, and R4 are triggered and the policy requests escalation", () => {
    const states = Object.fromEntries(rulesOf(CASE, G1).map((i) => [i.ruleId, i.state]));
    expect(states).toMatchObject({ R1: "REVIEW_REQUIRED", R2: "REVIEW_REQUIRED", R4: "REVIEW_REQUIRED", R3: "NOT_TRIGGERED" });
    const escalation = openTasks(findingOn(G1).id, "escalation");
    expect(escalation).toHaveLength(1);
    expect(escalation[0].assignedRole).toBe("senior_reviewer");
  });

  it("G1 history is stored from real reducer runs: NEEDS_CONTEXT at T5, REVIEW_REQUIRED at T11", () => {
    const r1 = rulesOf(CASE, G1).find((i) => i.ruleId === "R1")!;
    const steps = getDb().select().from(monitorEvaluations).where(eq(monitorEvaluations.instanceId, r1.id)).orderBy(asc(monitorEvaluations.seq)).all();
    expect(steps.map((s) => [s.turnLabel, s.result, s.nextState])).toEqual([
      ["T5", "indeterminate", "NEEDS_CONTEXT"],
      ["T11", "true", "REVIEW_REQUIRED"],
    ]);
    expect(statePath(["UNASSESSED", ...steps.map((s) => s.nextState)])).toEqual(["UNASSESSED", "NEEDS_CONTEXT", "REVIEW_REQUIRED"]);
    // The context task opened at T5 was closed by the monitor at T11, not by a person.
    const context = getDb().select().from(tasks).where(eq(tasks.findingId, findingOn(G1).id)).all().filter((t) => t.kind === "context");
    expect(context.length).toBeGreaterThan(0);
    expect(context.every((t) => t.status === "done")).toBe(true);
  });

  it("the workspace shows the same path on the finding, with the turn of each step", () => {
    const workspace = loadWorkspace(getDb(), CASE, user("marcus"));
    const f1 = workspace.findings.find((f) => f.claimLogicalKey === G1 && f.origin === "policy")!;
    expect(f1.label).toBe("F1");
    expect(f1.path.map((p) => p.state)).toEqual(["UNASSESSED", "NEEDS_CONTEXT", "REVIEW_REQUIRED"]);
    expect(f1.path.map((p) => p.turnLabel)).toEqual([null, "T5", "T11"]);
    expect(f1.turnLabels).toEqual(["T5", "T11"]);
    expect(f1.escalationRequired).toBe(true);
    expect(f1.rules.filter((r) => r.state === "REVIEW_REQUIRED").map((r) => r.ruleId)).toEqual(["R1", "R2", "R4"]);
  });

  it("G2 is triggered by R3; G3 needs context under R1 and has an open context task", () => {
    expect(rulesOf(CASE, G2).find((i) => i.ruleId === "R3")!.state).toBe("REVIEW_REQUIRED");
    expect(rulesOf(CASE, G3).find((i) => i.ruleId === "R1")!.state).toBe("NEEDS_CONTEXT");
    expect(rulesOf(CASE, G3).find((i) => i.ruleId === "R4")!.state).toBe("NOT_TRIGGERED");
    expect(openTasks(findingOn(G3).id, "context")).toHaveLength(1);
  });

  it("opens no policy finding on T7, T9, T13, T19, or T21", () => {
    const flagged = new Set(findingsOf().filter((f) => f.origin === "policy").map((f) => f.claimLogicalKey));
    const quiet = loadCurrentClaims(getDb(), CASE).filter((c) => c.turnLabels.some((t) => ["T7", "T9", "T13", "T19", "T21"].includes(t)));
    expect(quiet.length).toBeGreaterThanOrEqual(5);
    expect(quiet.filter((c) => flagged.has(c.row.logicalKey))).toEqual([]);
  });

  it("raises the AI-suggested concern separately, labeled, after the policy findings", () => {
    const ai = findingsOf().filter((f) => f.origin === "ai_suggested");
    expect(ai).toHaveLength(1);
    expect(ai[0].seqNo).toBe(4);
    expect(ai[0].state).toBe("REVIEW_REQUIRED");
    expect(JSON.parse(ai[0].reasonCodesJson)).toEqual(["AI_SUGGESTED"]);
  });

  it("stores the public-evidence comparisons the gold labels expect (§16 Phase 5)", () => {
    const claims = loadCurrentClaims(getDb(), CASE);
    const outcomeAt = (turn: string) => {
      const compared = claims.map((c) => ({ c, match: loadPublicMatch(getDb(), CASE, { logicalKey: c.row.logicalKey, contentHash: c.row.contentHash }) })).find((x) => x.c.turnLabels.includes(turn) && x.match.comparison)!;
      return { outcome: compared.match.comparison!.outcome, reasons: compared.match.comparison!.reasons };
    };
    expect(outcomeAt("T11")).toEqual({ outcome: "mismatch_only", reasons: ["period", "scope"] });
    expect(outcomeAt("T13")).toEqual({ outcome: "exact_match", reasons: [] });
    expect(outcomeAt("T15")).toEqual({ outcome: "mismatch_only", reasons: ["PUBLISHED_AFTER_CALL"] });
  });

  it("replaying reevaluateCase with the same event creates no duplicate findings, tasks, or evaluations", () => {
    const count = () => ({
      findings: getDb().select().from(findings).all().length,
      tasks: getDb().select().from(tasks).all().length,
      evaluations: getDb().select().from(monitorEvaluations).all().length,
    });
    const before = count();
    const token = `run:${latestRun(getDb(), CASE)!.id}`;
    for (let i = 0; i < 2; i++) {
      const result = transact((tx) => reevaluateCase(tx, CASE, { actorId: "system", reason: "replay", eventType: "CLAIM_EVALUATED", eventToken: token }));
      expect(result).toMatchObject({ claimsEvaluated: 0, findingsOpened: 0, tasksOpened: 0 });
    }
    expect(count()).toEqual(before);
  });

  it("a new event that changes nothing adds evaluations but still no duplicate findings or open tasks", () => {
    const openBefore = getDb().select().from(tasks).all().filter((t) => t.status === "open").length;
    const findingsBefore = findingsOf().length;
    transact((tx) => reevaluateCase(tx, CASE, { actorId: "system", reason: "second look", eventType: "CLAIM_EVALUATED", eventToken: "manual:1" }));
    transact((tx) => reevaluateCase(tx, CASE, { actorId: "system", reason: "third look", eventType: "CLAIM_EVALUATED", eventToken: "manual:2" }));
    expect(findingsOf()).toHaveLength(findingsBefore);
    expect(getDb().select().from(tasks).all().filter((t) => t.status === "open")).toHaveLength(openBefore);
    expect(findingOn(G1).state).toBe("REVIEW_REQUIRED");
    expect(findingOn(G3).state).toBe("NEEDS_CONTEXT");
  });
});

describe("edge-case fixtures V1–V8 through the services (§18.2)", () => {
  beforeAll(seedAnalyzed);

  for (const v of loadVariants()) {
    it(`${v.id} ${v.title}: stored findings match the fixture`, () => {
      const caseId = analyzeFixtureCase(v.id, v.transcript, v.extraction);
      const claims = loadCurrentClaims(getDb(), caseId);
      const policyFindings = findingsOf(caseId).filter((f) => f.origin === "policy");

      for (const expected of v.expected.findings) {
        const claim = claims.find((c) => expected.turns.every((t) => c.quotes.some((q) => q.role === "primary" && q.turnLabel === t)));
        expect(claim, `claim on ${expected.turns.join("+")}`).toBeDefined();
        const finding = policyFindings.find((f) => f.claimLogicalKey === claim!.row.logicalKey);
        expect(finding, `finding on ${expected.turns.join("+")}`).toBeDefined();
        expect(expected.accept_states ?? [expected.expect_state]).toContain(finding!.state);
        if (expected.escalation) expect(openTasks(finding!.id, "escalation")).toHaveLength(1);
        if (expected.conflict) {
          // A conflict on any guard predicate opens a review task even when the guard is not true (§7.1).
          expect(finding!.state).toBe("REVIEW_REQUIRED");
          expect(openTasks(finding!.id, "review").length).toBeGreaterThan(0);
          expect((JSON.parse(finding!.reasonCodesJson) as string[]).some((c) => c.startsWith("CONFLICT:"))).toBe(true);
        }
      }
      expect(policyFindings).toHaveLength(v.expected.findings.length);
      // A case with zero findings still is not ready: the whole-call attestation is mandatory.
      expect(statusOf(caseId)).toBe("IN_REVIEW");
    });
  }

  it("V6: the conflict opens review although no rule's guard evaluated to true", () => {
    const v6 = loadVariants().find((v) => v.id === "V6")!;
    const caseId = "case_v6";
    const finding = findingsOf(caseId).find((f) => f.origin === "policy")!;
    expect(v6.expected.findings[0].conflict).toBe(true);
    const instances = getDb().select().from(monitorInstances).where(eq(monitorInstances.caseId, caseId)).all();
    const evaluations = getDb().select().from(monitorEvaluations).where(inArray(monitorEvaluations.instanceId, instances.map((i) => i.id))).all();
    expect(evaluations.some((e) => e.conflictFlag)).toBe(true);
    expect(evaluations.filter((e) => e.conflictFlag).every((e) => e.result !== "true")).toBe(true);
    expect(finding.state).toBe("REVIEW_REQUIRED");
  });
});
