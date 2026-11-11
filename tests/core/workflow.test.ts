import { describe, expect, it } from "vitest";
import { type ReleaseCheckInput, checkRelease, citedClaimKeys, claimEligibility, enforceBriefCitations, findingHidesClaim, hiddenBy, renderBriefMarkdown, transitionBrief } from "@/core/workflow/brief";
import { reviewBlockers, transitionCase } from "@/core/workflow/case";
import { type FindingGuardContext, aggregateMonitorStates, initialFindingState, statePath, transitionFinding } from "@/core/workflow/finding";
import { isImmutable, transitionPolicyVersion } from "@/core/workflow/policyVersion";

const reviewer: FindingGuardContext = { actorRole: "reviewer", escalationRequired: false, hasOpenBlockingIssue: false };
const senior: FindingGuardContext = { ...reviewer, actorRole: "senior_reviewer" };
const system: FindingGuardContext = { ...reviewer, actorRole: "system" };
const RATIONALE = "Reviewed the linked passages and the public comparison.";

describe("finding workflow", () => {
  it("a reviewer disposes a REVIEW_REQUIRED finding with an allowed outcome and a rationale", () => {
    expect(transitionFinding("REVIEW_REQUIRED", { type: "DISPOSE", outcome: "restricted_exclude", rationale: RATIONALE }, reviewer)).toEqual({ ok: true, next: "DISPOSITIONED", changed: true, decisionKind: "disposition" });
  });

  it("requires a rationale of at least 20 characters", () => {
    expect(transitionFinding("REVIEW_REQUIRED", { type: "DISPOSE", outcome: "no_concern", rationale: "looks fine" }, reviewer)).toMatchObject({ ok: false, error: "GUARD_FAILED" });
  });

  it("blocks disposition while a blocking processing issue is open on the claim", () => {
    expect(transitionFinding("REVIEW_REQUIRED", { type: "DISPOSE", outcome: "no_concern", rationale: RATIONALE }, { ...reviewer, hasOpenBlockingIssue: true })).toMatchObject({ ok: false, error: "GUARD_FAILED" });
  });

  it("a reviewer cannot record restricted_escalate_to_legal", () => {
    expect(transitionFinding("REVIEW_REQUIRED", { type: "DISPOSE", outcome: "restricted_escalate_to_legal", rationale: RATIONALE }, reviewer)).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
  });

  it("a reviewer cannot dispose of an escalated finding; a senior reviewer can", () => {
    expect(transitionFinding("ESCALATED", { type: "DISPOSE", outcome: "no_concern", rationale: RATIONALE }, reviewer)).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
    expect(transitionFinding("ESCALATED", { type: "DISPOSE", outcome: "restricted_escalate_to_legal", rationale: RATIONALE }, senior)).toEqual({ ok: true, next: "DISPOSITIONED", changed: true, decisionKind: "escalation_decision" });
  });

  it("a policy escalation request also reserves the decision for a senior reviewer", () => {
    const ctx = { ...reviewer, escalationRequired: true };
    expect(transitionFinding("REVIEW_REQUIRED", { type: "DISPOSE", outcome: "restricted_exclude", rationale: RATIONALE }, ctx)).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
    expect(transitionFinding("REVIEW_REQUIRED", { type: "DISPOSE", outcome: "restricted_escalate_to_legal", rationale: RATIONALE }, { ...ctx, actorRole: "senior_reviewer" })).toMatchObject({ ok: true, next: "DISPOSITIONED", decisionKind: "escalation_decision" });
    expect(transitionFinding("REVIEW_REQUIRED", { type: "ESCALATE", rationale: "Policy R2 requires a senior decision." }, ctx)).toMatchObject({ ok: true, next: "ESCALATED", decisionKind: "escalation_request" });
  });

  it("analysts and policy owners cannot act on findings", () => {
    for (const actorRole of ["analyst", "policy_owner"] as const) {
      expect(transitionFinding("REVIEW_REQUIRED", { type: "DISPOSE", outcome: "no_concern", rationale: RATIONALE }, { ...reviewer, actorRole })).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
      expect(transitionFinding("REVIEW_REQUIRED", { type: "ESCALATE", rationale: "x" }, { ...reviewer, actorRole })).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
    }
  });

  it("NEEDS_CONTEXT cannot be decided directly; it can be promoted with a rationale", () => {
    expect(transitionFinding("NEEDS_CONTEXT", { type: "DISPOSE", outcome: "no_concern", rationale: RATIONALE }, reviewer)).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
    expect(transitionFinding("NEEDS_CONTEXT", { type: "PROMOTE", rationale: "" }, reviewer)).toMatchObject({ ok: false, error: "GUARD_FAILED" });
    expect(transitionFinding("NEEDS_CONTEXT", { type: "PROMOTE", rationale: "Expert unreachable." }, reviewer)).toMatchObject({ ok: true, next: "REVIEW_REQUIRED" });
  });

  it("monitor false after context → pending acknowledgement, and only no_concern closes it", () => {
    expect(transitionFinding("NEEDS_CONTEXT", { type: "MONITOR_NOT_TRIGGERED" }, system)).toMatchObject({ ok: true, next: "NOT_TRIGGERED_PENDING_ACK" });
    expect(transitionFinding("NOT_TRIGGERED_PENDING_ACK", { type: "DISPOSE", outcome: "cleared_for_research", rationale: RATIONALE }, reviewer)).toMatchObject({ ok: false, error: "GUARD_FAILED" });
    expect(transitionFinding("NOT_TRIGGERED_PENDING_ACK", { type: "DISPOSE", outcome: "no_concern", rationale: "Acknowledged." }, reviewer)).toMatchObject({ ok: true, next: "DISPOSITIONED" });
  });

  it("a monitor can raise a finding to review but never clear or close it", () => {
    expect(transitionFinding("NEEDS_CONTEXT", { type: "MONITOR_REVIEW_REQUIRED" }, system)).toMatchObject({ next: "REVIEW_REQUIRED" });
    expect(transitionFinding("ESCALATED", { type: "MONITOR_REVIEW_REQUIRED" }, system)).toMatchObject({ next: "ESCALATED", changed: false });
    expect(transitionFinding("REVIEW_REQUIRED", { type: "MONITOR_NOT_TRIGGERED" }, system)).toMatchObject({ next: "REVIEW_REQUIRED", changed: false });
    expect(transitionFinding("DISPOSITIONED", { type: "MONITOR_NOT_TRIGGERED" }, system)).toMatchObject({ next: "DISPOSITIONED", changed: false });
    expect(transitionFinding("NEEDS_CONTEXT", { type: "MONITOR_NOT_TRIGGERED" }, reviewer)).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
  });

  it("a changed dependency reopens a decided finding, which returns to review", () => {
    expect(transitionFinding("DISPOSITIONED", { type: "DEPENDENCY_CHANGED" }, system)).toMatchObject({ next: "REOPENED", changed: true });
    expect(transitionFinding("REOPENED", { type: "REEVALUATED" }, system)).toMatchObject({ next: "REVIEW_REQUIRED" });
    expect(transitionFinding("REVIEW_REQUIRED", { type: "DEPENDENCY_CHANGED" }, system)).toMatchObject({ changed: false });
  });

  it("aggregates monitor states by seriousness", () => {
    expect(aggregateMonitorStates(["NOT_TRIGGERED", "NEEDS_CONTEXT", "REVIEW_REQUIRED"])).toBe("REVIEW_REQUIRED");
    expect(aggregateMonitorStates(["NOT_TRIGGERED", "ESCALATION_REQUESTED"])).toBe("REVIEW_REQUIRED");
    expect(aggregateMonitorStates(["NOT_TRIGGERED", "NEEDS_CONTEXT"])).toBe("NEEDS_CONTEXT");
    expect(aggregateMonitorStates(["NOT_TRIGGERED", "UNASSESSED"])).toBe("NOT_TRIGGERED");
    expect(aggregateMonitorStates([])).toBe("UNASSESSED");
    expect(initialFindingState("NOT_TRIGGERED")).toBeNull();
    expect(statePath(["UNASSESSED", "NEEDS_CONTEXT", "NEEDS_CONTEXT", "REVIEW_REQUIRED"])).toEqual(["UNASSESSED", "NEEDS_CONTEXT", "REVIEW_REQUIRED"]);
  });
});

describe("policy-version lifecycle", () => {
  it("only the policy owner may compile or approve", () => {
    for (const role of ["analyst", "reviewer", "senior_reviewer"] as const) {
      expect(transitionPolicyVersion("DRAFT", { type: "COMPILE_REQUESTED" }, role)).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
      expect(transitionPolicyVersion("VALIDATED", { type: "APPROVE", bundleHash: "h", storedBundleHash: "h" }, role)).toMatchObject({ ok: false, error: "FORBIDDEN_ROLE" });
    }
    expect(transitionPolicyVersion("DRAFT", { type: "COMPILE_REQUESTED" }, "policy_owner")).toEqual({ ok: true, next: "COMPILING" });
  });

  it("approve needs VALIDATED and the exact bundle hash", () => {
    expect(transitionPolicyVersion("VALIDATED", { type: "APPROVE", bundleHash: "abc", storedBundleHash: "abc" }, "policy_owner")).toEqual({ ok: true, next: "ACTIVE" });
    expect(transitionPolicyVersion("VALIDATED", { type: "APPROVE", bundleHash: "abd", storedBundleHash: "abc" }, "policy_owner")).toMatchObject({ ok: false, error: "HASH_MISMATCH" });
    expect(transitionPolicyVersion("VALIDATED", { type: "APPROVE", bundleHash: "", storedBundleHash: null }, "policy_owner")).toMatchObject({ ok: false, error: "HASH_MISMATCH" });
  });

  it("COMPILE_FAILED can never become ACTIVE, but can be recompiled", () => {
    expect(transitionPolicyVersion("COMPILE_FAILED", { type: "APPROVE", bundleHash: "h", storedBundleHash: "h" }, "policy_owner")).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
    expect(transitionPolicyVersion("COMPILE_FAILED", { type: "COMPILE_REQUESTED" }, "policy_owner")).toEqual({ ok: true, next: "COMPILING" });
    for (const status of ["DRAFT", "COMPILING", "ACTIVE", "SUPERSEDED"] as const) {
      expect(transitionPolicyVersion(status, { type: "APPROVE", bundleHash: "h", storedBundleHash: "h" }, "policy_owner")).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
    }
  });

  it("ACTIVE versions are immutable and can only be superseded", () => {
    expect(isImmutable("ACTIVE")).toBe(true);
    expect(isImmutable("SUPERSEDED")).toBe(true);
    expect(isImmutable("VALIDATED")).toBe(false);
    expect(transitionPolicyVersion("ACTIVE", { type: "COMPILE_REQUESTED" }, "policy_owner")).toMatchObject({ ok: false, error: "INVALID_TRANSITION" });
    expect(transitionPolicyVersion("ACTIVE", { type: "SUPERSEDE" }, "system")).toEqual({ ok: true, next: "SUPERSEDED" });
    expect(transitionPolicyVersion("COMPILING", { type: "COMPILE_FAILED" }, "system")).toEqual({ ok: true, next: "COMPILE_FAILED" });
    expect(transitionPolicyVersion("COMPILING", { type: "COMPILE_SUCCEEDED" }, "system")).toEqual({ ok: true, next: "VALIDATED" });
  });
});

describe("case workflow", () => {
  it("walks the happy path", () => {
    expect(transitionCase("INTAKE", "ANALYSIS_STARTED")).toMatchObject({ next: "ANALYZING" });
    expect(transitionCase("ANALYZING", "ANALYSIS_SUCCEEDED")).toMatchObject({ next: "IN_REVIEW" });
    expect(transitionCase("IN_REVIEW", "REVIEW_COMPLETE")).toMatchObject({ next: "READY_FOR_APPROVAL" });
    expect(transitionCase("READY_FOR_APPROVAL", "BRIEF_APPROVED")).toMatchObject({ next: "APPROVED" });
    expect(transitionCase("APPROVED", "BRIEF_RELEASED")).toMatchObject({ next: "RELEASED" });
  });

  it("refuses approval and release out of order", () => {
    expect(transitionCase("IN_REVIEW", "BRIEF_APPROVED").ok).toBe(false);
    expect(transitionCase("READY_FOR_APPROVAL", "BRIEF_RELEASED").ok).toBe(false);
    expect(transitionCase("STALE", "BRIEF_RELEASED").ok).toBe(false);
  });

  it("any staleness moves APPROVED or RELEASED to STALE, then back to IN_REVIEW", () => {
    expect(transitionCase("APPROVED", "EVIDENCE_CHANGED")).toMatchObject({ next: "STALE" });
    expect(transitionCase("RELEASED", "EVIDENCE_CHANGED")).toMatchObject({ next: "STALE" });
    expect(transitionCase("RELEASED", "ANALYSIS_STARTED")).toMatchObject({ next: "STALE" });
    expect(transitionCase("STALE", "REEVALUATED")).toMatchObject({ next: "IN_REVIEW" });
    expect(transitionCase("IN_REVIEW", "EVIDENCE_CHANGED")).toMatchObject({ next: "IN_REVIEW", changed: false });
    expect(transitionCase("READY_FOR_APPROVAL", "REVIEW_INCOMPLETE")).toMatchObject({ next: "IN_REVIEW" });
    expect(transitionCase("APPROVED", "APPROVAL_VOIDED")).toMatchObject({ next: "READY_FOR_APPROVAL" });
  });

  const ready = {
    findings: [{ id: "f1", label: "F1", state: "DISPOSITIONED", decision: { stale: false, outcome: "no_concern" } }],
    openBlockingIssues: [],
    attestation: { stale: false, transcriptVersionId: "tv1" },
    currentTranscriptVersionId: "tv1",
    currentTranscriptLabel: "transcript v1",
  };

  it("is ready only when every condition holds", () => {
    expect(reviewBlockers(ready)).toEqual([]);
    expect(reviewBlockers({ ...ready, findings: [{ ...ready.findings[0], state: "REVIEW_REQUIRED", decision: null }] }).map((b) => b.code)).toEqual(["FINDING_OPEN"]);
    expect(reviewBlockers({ ...ready, findings: [{ ...ready.findings[0], decision: { stale: true, outcome: "no_concern" } }] }).map((b) => b.code)).toEqual(["DECISION_STALE"]);
    expect(reviewBlockers({ ...ready, openBlockingIssues: [{ code: "LLM_REFUSAL", message: "refused" }] }).map((b) => b.code)).toEqual(["PROCESSING_ISSUE_OPEN"]);
  });

  it("needs an attestation even with zero findings, and a new one for a new transcript version", () => {
    expect(reviewBlockers({ ...ready, findings: [], attestation: null }).map((b) => b.code)).toEqual(["ATTESTATION_MISSING"]);
    expect(reviewBlockers({ ...ready, attestation: { stale: true, transcriptVersionId: "tv1" } }).map((b) => b.code)).toEqual(["ATTESTATION_STALE"]);
    const v2 = reviewBlockers({ ...ready, currentTranscriptVersionId: "tv2", currentTranscriptLabel: "transcript v2" });
    expect(v2).toEqual([{ code: "ATTESTATION_STALE", message: "attestation stale: transcript v2" }]);
  });
});

/** A release check where everything holds; each test overrides what it breaks. */
const approval = { briefHash: "h1", audience: "analyst", stale: false, staleReason: null };
const okRelease: ReleaseCheckInput = {
  actorRole: "reviewer",
  audience: "analyst",
  expectedBriefVersion: 2,
  brief: { version: 2, status: "approved", contentHash: "h1", label: "Brief v1" },
  latestApproval: approval,
  caseStatus: "APPROVED",
  reviewBlockers: [],
  ineligibleCitations: [],
  newlyStale: [],
  leaks: [],
  citationLeaks: [],
  unplacedPassages: [],
};

describe("brief workflow, eligibility, and release check", () => {
  it("DRAFT → APPROVED → RELEASED, with STALE from approved or released only", () => {
    expect(transitionBrief("draft", "APPROVE")).toMatchObject({ next: "approved" });
    expect(transitionBrief("approved", "RELEASE")).toMatchObject({ next: "released" });
    expect(transitionBrief("approved", "DEPENDENCY_CHANGED")).toMatchObject({ next: "stale" });
    expect(transitionBrief("released", "DEPENDENCY_CHANGED")).toMatchObject({ next: "stale" });
    expect(transitionBrief("draft", "DEPENDENCY_CHANGED")).toMatchObject({ next: "draft", changed: false });
    expect(transitionBrief("draft", "RELEASE").ok).toBe(false);
    expect(transitionBrief("stale", "APPROVE").ok).toBe(false);
    expect(transitionBrief("released", "APPROVE").ok).toBe(false);
  });

  const claim = { logicalKey: "C1", status: "proposed" as const };
  const finding = (state: string, outcome: string | null, stale = false) => ({ claimLogicalKey: "C1", label: "F1", state, decision: outcome ? { outcome, stale } : null });

  it("a claim with no finding is eligible; a rejected claim never is", () => {
    expect(claimEligibility(claim, [])).toEqual({ eligible: true });
    expect(claimEligibility(claim, [{ ...finding("REVIEW_REQUIRED", null), claimLogicalKey: "C2" }])).toEqual({ eligible: true });
    expect(claimEligibility({ ...claim, status: "rejected" }, [])).toMatchObject({ eligible: false, reason: "rejected" });
  });

  it("eligibility needs every finding dispositioned cleared or no_concern, with a fresh decision", () => {
    expect(claimEligibility(claim, [finding("DISPOSITIONED", "cleared_for_research")])).toEqual({ eligible: true });
    expect(claimEligibility(claim, [finding("DISPOSITIONED", "no_concern")])).toEqual({ eligible: true });
    expect(claimEligibility(claim, [finding("REVIEW_REQUIRED", null)])).toMatchObject({ eligible: false, reason: "finding_open" });
    expect(claimEligibility(claim, [finding("DISPOSITIONED", "restricted_exclude")])).toMatchObject({ eligible: false, reason: "restricted" });
    expect(claimEligibility(claim, [finding("DISPOSITIONED", "restricted_escalate_to_legal")])).toMatchObject({ eligible: false, reason: "restricted" });
    expect(claimEligibility(claim, [finding("DISPOSITIONED", "no_concern", true)])).toMatchObject({ eligible: false, reason: "decision_stale" });
    expect(claimEligibility(claim, [finding("DISPOSITIONED", "no_concern"), finding("DISPOSITIONED", "restricted_exclude")])).toMatchObject({ eligible: false });
  });

  it("drops brief sentences with no citation or an ineligible one, and lists them", () => {
    const sections = [
      { heading: "Demand", sentences: [{ text: "Distributors are soft.", claim_ids: ["C2"] }, { text: "Bookings fell 20%.", claim_ids: ["C1"] }, { text: "Unsupported aside.", claim_ids: [] }] },
      { heading: "Empty", sentences: [{ text: "Only restricted.", claim_ids: ["C2", "C7"] }] },
    ];
    const out = enforceBriefCitations(sections, new Set(["C2", "C9"]));
    expect(out.sections).toEqual([{ heading: "Demand", sentences: [{ text: "Distributors are soft.", claim_ids: ["C2"] }] }]);
    expect(out.dropped.map((d) => d.reason)).toEqual(["cites C1, which is not eligible", "no claim cited", "cites C7, which is not eligible"]);
    expect(citedClaimKeys(out.sections)).toEqual(["C2"]);
  });

  it("the brief footer states how many statements were withheld, never their content", () => {
    const md = renderBriefMarkdown("Halvorsen brief", [{ heading: "Demand", sentences: [{ text: "Distributors are soft.", claim_ids: ["C2"] }] }], 2);
    expect(md).toContain("2 statements withheld by compliance.");
    expect(md).toContain("- Distributors are soft. [C2]");
    expect(renderBriefMarkdown("t", [], 1)).toContain("1 statement withheld by compliance.");
  });

  it("passes when everything holds", () => expect(checkRelease(okRelease)).toEqual([]));

  it("fails on each condition with its own code", () => {
    const codes = (over: Partial<ReleaseCheckInput>) => checkRelease({ ...okRelease, ...over }).map((f) => f.code);
    expect(codes({ actorRole: "analyst" as never })).toEqual(["ROLE_NOT_ALLOWED"]);
    expect(codes({ expectedBriefVersion: 1 })).toEqual(["VERSION_CONFLICT"]);
    expect(codes({ latestApproval: { ...approval, stale: true, staleReason: "claim changed (C9 · T19)" } })).toEqual(["APPROVAL_STALE"]);
    expect(codes({ latestApproval: { ...approval, briefHash: "other" } })).toEqual(["BRIEF_HASH_MISMATCH"]);
    expect(codes({ audience: "external" })).toEqual(["WRONG_AUDIENCE"]);
    expect(codes({ latestApproval: null })).toEqual(["APPROVAL_MISSING"]);
    expect(codes({ caseStatus: "IN_REVIEW" })).toEqual(["CASE_NOT_APPROVED"]);
    expect(codes({ reviewBlockers: [{ code: "FINDING_OPEN", message: "finding F1 is REVIEW_REQUIRED" }] })).toEqual(["FINDING_OPEN"]);
    expect(codes({ reviewBlockers: [{ code: "ATTESTATION_MISSING", message: "m" }] })).toEqual(["ATTESTATION_MISSING"]);
    expect(codes({ reviewBlockers: [{ code: "PROCESSING_ISSUE_OPEN", message: "m" }] })).toEqual(["PROCESSING_ISSUE_OPEN"]);
    expect(codes({ ineligibleCitations: [{ claimKey: "C7", detail: "restricted" }] })).toEqual(["CLAIM_NOT_ELIGIBLE"]);
    expect(codes({ newlyStale: [{ dependent: "approval", reason: "claim changed" }] })).toEqual(["STALE_DEPENDENCY"]);
  });

  it("a leaking summary fails with SUMMARY_LEAK, naming the passage and kind but never the hidden text", () => {
    const failures = checkRelease({ ...okRelease, leaks: [{ passage: "F1 · T5", kind: "figure", detail: "20" }] });
    expect(failures).toEqual([{ code: "SUMMARY_LEAK", message: "the summary repeats a figure from hidden passage F1 · T5", ref: "F1 · T5" }]);
    const quote = checkRelease({ ...okRelease, leaks: [{ passage: "F2 · T15", kind: "quote", detail: "the cardinal utilities contract is being" }] });
    expect(quote[0].message).toBe("the summary repeats a quote from hidden passage F2 · T15");
    expect(quote[0].message).not.toContain("cardinal");
  });

  it("a hidden passage that cannot be placed fails with HIDDEN_PASSAGE_UNPLACED, naming only its label", () => {
    expect(checkRelease({ ...okRelease, unplacedPassages: ["F4 · T3"] })).toEqual([
      { code: "HIDDEN_PASSAGE_UNPLACED", message: "hidden passage F4 · T3 could not be placed on the current transcript, so it cannot be blanked", ref: "F4 · T3" },
    ]);
  });

  it("a claim's passages stay hidden while any finding on it is not cleared, even once the claim is rejected", () => {
    const rejected = { ...claim, status: "rejected" as const, turnLabels: ["T5"] };
    expect(hiddenBy(rejected, [finding("DISPOSITIONED", "restricted_exclude")])).toBe("F1");
    expect(hiddenBy(rejected, [finding("REVIEW_REQUIRED", null)])).toBe("F1");
    expect(hiddenBy(rejected, [finding("DISPOSITIONED", "no_concern", true)])).toBe("F1");
    expect(hiddenBy(rejected, [finding("DISPOSITIONED", "no_concern")])).toBeNull();
    expect(hiddenBy(rejected, [])).toBeNull();
    const live = { claimLogicalKey: null, turnLabels: ["T5"], label: "F4", state: "REVIEW_REQUIRED", decision: null };
    expect(hiddenBy({ ...claim, turnLabels: ["T5"] }, [live])).toBe("F4");
    expect(hiddenBy({ ...claim, turnLabels: ["T9"] }, [live])).toBeNull();
  });

  it("a claim quoting a turn of an undecided live finding is restricted", () => {
    const live = (state: string, outcome: string | null, stale = false) => ({ claimLogicalKey: null, turnLabels: ["T7"], label: "F4", state, decision: outcome ? { outcome, stale } : null });
    const onT7 = { ...claim, turnLabels: ["T7"] };
    expect(claimEligibility(onT7, [live("REVIEW_REQUIRED", null)])).toMatchObject({ eligible: false, reason: "restricted" });
    expect(claimEligibility(onT7, [live("DISPOSITIONED", "restricted_exclude")])).toMatchObject({ eligible: false, reason: "restricted" });
    expect(claimEligibility(onT7, [live("DISPOSITIONED", "cleared_for_research", true)])).toMatchObject({ eligible: false, reason: "restricted" });
    expect(claimEligibility(onT7, [live("DISPOSITIONED", "cleared_for_research")])).toEqual({ eligible: true });
    expect(claimEligibility(onT7, [live("DISPOSITIONED", "no_concern")])).toEqual({ eligible: true });
    expect(claimEligibility({ ...claim, turnLabels: ["T9"] }, [live("REVIEW_REQUIRED", null)])).toEqual({ eligible: true });
    expect(claimEligibility(claim, [live("REVIEW_REQUIRED", null)])).toEqual({ eligible: true }); // no turns known: nothing to match
  });

  it("lists every failure at once (the red checklist)", () => {
    const failures = checkRelease({
      ...okRelease,
      brief: { ...okRelease.brief, status: "stale" },
      latestApproval: { ...approval, stale: true, staleReason: "claim changed (C9 · T19)" },
      caseStatus: "IN_REVIEW",
      reviewBlockers: [{ code: "ATTESTATION_STALE", message: "attestation stale: transcript v2" }],
    });
    expect(failures.map((f) => f.code)).toEqual(["BRIEF_NOT_APPROVED", "APPROVAL_STALE", "CASE_NOT_APPROVED", "ATTESTATION_STALE"]);
    expect(failures[1].message).toBe("approval stale: claim changed (C9 · T19)");
    expect(failures[3].message).toBe("attestation stale: transcript v2");
  });
});

describe("eligibility by hidden span (Fix A)", () => {
  // The deployed run's shape: C8 quotes the whole first sentence of T15 and is under an after-call finding;
  // C7 quotes part of that same sentence and has no finding of its own.
  const c7 = { logicalKey: "C7", status: "proposed" as const, turnLabels: ["T15"], spans: [{ turnLabel: "T15", start: 0, end: 55 }] };
  const f2 = (state: string, outcome: string | null, stale = false) => ({
    claimLogicalKey: "C8",
    label: "F2",
    state,
    decision: outcome ? { outcome, stale } : null,
    hiddenSpans: [{ turnLabel: "T15", start: 0, end: 180 }],
  });
  const onT15 = (start: number, end: number) => ({ ...c7, spans: [{ turnLabel: "T15", start, end }] });
  const hiding = (start: number, end: number) => ({ ...f2("REVIEW_REQUIRED", null), hiddenSpans: [{ turnLabel: "T15", start, end }] });

  it("a claim quoting words inside another claim's hidden quote is restricted, naming only the finding and the turn", () => {
    for (const f of [f2("REVIEW_REQUIRED", null), f2("NEEDS_CONTEXT", null), f2("DISPOSITIONED", "restricted_escalate_to_legal"), f2("DISPOSITIONED", "no_concern", true)]) {
      const e = claimEligibility(c7, [f]);
      expect(e).toEqual({ eligible: false, reason: "restricted", detail: "it quotes words in T15 that finding F2 keeps hidden" });
    }
  });

  it("touching spans do not overlap; spans sharing one character do", () => {
    expect(claimEligibility(onT15(30, 60), [hiding(0, 30)])).toEqual({ eligible: true });
    expect(claimEligibility(onT15(0, 30), [hiding(30, 60)])).toEqual({ eligible: true });
    expect(claimEligibility(onT15(29, 60), [hiding(0, 30)])).toMatchObject({ eligible: false, reason: "restricted" });
    expect(claimEligibility(onT15(0, 31), [hiding(30, 60)])).toMatchObject({ eligible: false, reason: "restricted" });
    expect(claimEligibility(onT15(10, 20), [hiding(0, 30)])).toMatchObject({ eligible: false, reason: "restricted" }); // inside
    expect(claimEligibility(onT15(0, 90), [hiding(30, 60)])).toMatchObject({ eligible: false, reason: "restricted" }); // around
  });

  it("the same offsets on a different turn do not restrict", () => {
    expect(claimEligibility({ ...c7, turnLabels: ["T16"], spans: [{ turnLabel: "T16", start: 0, end: 55 }] }, [f2("REVIEW_REQUIRED", null)])).toEqual({ eligible: true });
  });

  it("a cleared finding does not restrict", () => {
    expect(claimEligibility(c7, [f2("DISPOSITIONED", "cleared_for_research")])).toEqual({ eligible: true });
    expect(claimEligibility(c7, [f2("DISPOSITIONED", "no_concern")])).toEqual({ eligible: true });
  });

  it("any one of a claim's quotes overlapping is enough", () => {
    const twoQuotes = { ...c7, spans: [{ turnLabel: "T14", start: 0, end: 40 }, { turnLabel: "T15", start: 100, end: 120 }] };
    expect(claimEligibility(twoQuotes, [f2("REVIEW_REQUIRED", null)])).toMatchObject({ eligible: false, reason: "restricted" });
  });

  it("a claim's own finding keeps its own reasons, and its hidden spans are not held against the claim itself", () => {
    const own = (state: string, outcome: string | null, stale = false) => ({ ...f2(state, outcome, stale), claimLogicalKey: "C7" });
    expect(claimEligibility(c7, [own("REVIEW_REQUIRED", null)])).toMatchObject({ eligible: false, reason: "finding_open" });
    expect(claimEligibility(c7, [own("DISPOSITIONED", "no_concern", true)])).toMatchObject({ eligible: false, reason: "decision_stale" });
    expect(claimEligibility(c7, [own("DISPOSITIONED", "restricted_exclude")])).toMatchObject({ eligible: false, reason: "restricted", detail: "finding F2 was dispositioned restricted_exclude" });
    expect(claimEligibility(c7, [own("DISPOSITIONED", "no_concern")])).toEqual({ eligible: true });
    // Cleared on its own finding, but another finding still hides some of its words.
    expect(claimEligibility(c7, [own("DISPOSITIONED", "no_concern"), { ...f2("REVIEW_REQUIRED", null), label: "F5" }])).toMatchObject({ eligible: false, reason: "restricted", detail: "it quotes words in T15 that finding F5 keeps hidden" });
  });

  it("the transcript blanks exactly what it did: hiddenBy ignores spans", () => {
    expect(hiddenBy(c7, [f2("REVIEW_REQUIRED", null)])).toBeNull();
    expect(hiddenBy({ ...c7, logicalKey: "C8" }, [f2("REVIEW_REQUIRED", null)])).toBe("F2");
  });

  it("a finding hides a claim's quotes when it is on the claim or shares a turn as a live finding", () => {
    const live = { claimLogicalKey: null, turnLabels: ["T5"], label: "F4", state: "REVIEW_REQUIRED", decision: null };
    expect(findingHidesClaim(live, { logicalKey: "C1", status: "proposed", turnLabels: ["T5", "T11"] })).toBe(true);
    expect(findingHidesClaim(live, { logicalKey: "C1", status: "proposed", turnLabels: ["T11"] })).toBe(false);
    expect(findingHidesClaim(f2("REVIEW_REQUIRED", null), { logicalKey: "C8", status: "rejected" })).toBe(true);
    expect(findingHidesClaim(f2("REVIEW_REQUIRED", null), c7)).toBe(false);
  });
});

describe("release check: the cited claims' summaries (Fix A)", () => {
  it("passes with no citation leak", () => expect(checkRelease(okRelease)).toEqual([]));

  it("a cited claim's summary that repeats hidden words fails with CITATION_LEAK, naming the claim and passage but never the text", () => {
    const failures = checkRelease({
      ...okRelease,
      citationLeaks: [
        { claimKey: "C7", passage: "F2 · T15", kind: "quote", detail: "the cardinal utilities contract is being" },
        { claimKey: "C7", passage: "F2 · T15", kind: "quote", detail: "halvorsen is out that hasn't been" },
        { claimKey: "C7", passage: "F2 · T15", kind: "name", detail: "Cardinal Utilities" },
      ],
    });
    expect(failures).toEqual([
      { code: "CITATION_LEAK", message: "the summary of cited claim C7 repeats a quote from hidden passage F2 · T15", ref: "C7" },
      { code: "CITATION_LEAK", message: "the summary of cited claim C7 repeats a name from hidden passage F2 · T15", ref: "C7" },
    ]);
    expect(JSON.stringify(failures)).not.toMatch(/cardinal/i);
  });
});
