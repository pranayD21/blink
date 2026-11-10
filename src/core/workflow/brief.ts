/**
 * The brief workflow (§9.4), brief eligibility (§12.5), and the release
 * check (§12.4). Fixed code.
 *
 *   DRAFT → APPROVED → RELEASED, with STALE reachable from APPROVED and RELEASED.
 *
 * Editing brief text creates a new brief version with a new hash, which voids
 * prior approvals.
 */
import type { BriefSection } from "../deps/hash";
import type { Role } from "../types";

export const BRIEF_STATUSES = ["draft", "approved", "released", "stale"] as const;
export type BriefStatus = (typeof BRIEF_STATUSES)[number];

export type BriefEvent = "APPROVE" | "RELEASE" | "DEPENDENCY_CHANGED" | "SUPERSEDED";

export type BriefTransition = { ok: true; next: BriefStatus; changed: boolean } | { ok: false; message: string };

export function transitionBrief(status: BriefStatus, event: BriefEvent): BriefTransition {
  const to = (next: BriefStatus): BriefTransition => ({ ok: true, next, changed: next !== status });
  switch (event) {
    case "APPROVE":
      if (status !== "draft") return { ok: false, message: `only a draft brief can be approved (this one is ${status})` };
      return to("approved");
    case "RELEASE":
      if (status !== "approved") return { ok: false, message: `only an approved brief can be released (this one is ${status})` };
      return to("released");
    case "DEPENDENCY_CHANGED":
    case "SUPERSEDED":
      // A draft was never approved, so there is nothing to invalidate.
      if (status === "approved" || status === "released") return to("stale");
      return to(status);
  }
}

// ── Eligibility (§12.5) ─────────────────────────────────────────────────────

export interface EligibilityClaim {
  logicalKey: string;
  status: "proposed" | "reviewer_corrected" | "rejected";
  /** The turns the claim quotes, matched against the turns a live finding hid. */
  turnLabels?: readonly string[];
}

export interface EligibilityFinding {
  claimLogicalKey: string | null;
  label: string;
  state: string;
  decision: { outcome: string | null; stale: boolean } | null;
  /** Set on a `live` finding: the turns it hid. A claim quoting any of them shares its fate. */
  turnLabels?: readonly string[];
}

export type Eligibility =
  | { eligible: true }
  /** `finding` is the label of the finding that made the claim ineligible, when one did. */
  | { eligible: false; reason: "rejected" | "finding_open" | "decision_stale" | "restricted"; detail: string; finding?: string };

const RELEASABLE_OUTCOMES = new Set(["cleared_for_research", "no_concern"]);

/** A live flag releases its turns only once compliance has cleared them, on a decision that still stands. */
export function liveFindingCleared(f: EligibilityFinding): boolean {
  return f.state === "DISPOSITIONED" && !!f.decision && !f.decision.stale && !!f.decision.outcome && RELEASABLE_OUTCOMES.has(f.decision.outcome);
}

/**
 * A claim may be cited in a brief only if it is not rejected and either no
 * finding references it, or every finding referencing it is DISPOSITIONED
 * with outcome cleared_for_research or no_concern and a non-stale decision.
 * A claim quoting any turn a live finding hid is restricted until that
 * finding is cleared the same way (fail closed, spec section 5).
 */
export function claimEligibility(claim: EligibilityClaim, findings: readonly EligibilityFinding[]): Eligibility {
  if (claim.status === "rejected") return { eligible: false, reason: "rejected", detail: "the claim was rejected" };
  const quoted = new Set(claim.turnLabels ?? []);
  for (const f of findings) {
    const shared = (f.turnLabels ?? []).filter((t) => quoted.has(t));
    if (shared.length > 0 && !liveFindingCleared(f)) {
      return { eligible: false, reason: "restricted", detail: `it quotes ${shared.join(", ")}, which live finding ${f.label} keeps hidden`, finding: f.label };
    }
  }
  for (const f of findings) {
    if (f.claimLogicalKey !== claim.logicalKey) continue;
    if (f.state !== "DISPOSITIONED" || !f.decision) {
      return { eligible: false, reason: "finding_open", detail: `finding ${f.label} is ${f.state}`, finding: f.label };
    }
    if (f.decision.stale) return { eligible: false, reason: "decision_stale", detail: `the decision on finding ${f.label} is stale`, finding: f.label };
    if (!f.decision.outcome || !RELEASABLE_OUTCOMES.has(f.decision.outcome)) {
      return { eligible: false, reason: "restricted", detail: `finding ${f.label} was dispositioned ${f.decision.outcome}`, finding: f.label };
    }
  }
  return { eligible: true };
}

/** The claim ids a brief cites, deduplicated, in first-citation order. */
export function citedClaimKeys(sections: readonly BriefSection[]): string[] {
  const seen = new Set<string>();
  for (const section of sections) for (const sentence of section.sentences) for (const id of sentence.claim_ids) seen.add(id);
  return [...seen];
}

export interface BriefCheckResult {
  sections: BriefSection[];
  dropped: { heading: string; text: string; reason: string }[];
}

/**
 * Server-side check of a drafted brief (§12.6): every sentence needs at least
 * one claim id, and every id must be eligible. A failing sentence is dropped
 * and listed, never silently kept.
 */
export function enforceBriefCitations(sections: readonly BriefSection[], eligibleKeys: ReadonlySet<string>): BriefCheckResult {
  const dropped: BriefCheckResult["dropped"] = [];
  const kept: BriefSection[] = [];
  for (const section of sections) {
    const sentences = section.sentences.filter((sentence) => {
      const text = sentence.text.trim();
      if (!text) return false;
      if (sentence.claim_ids.length === 0) {
        dropped.push({ heading: section.heading, text, reason: "no claim cited" });
        return false;
      }
      const bad = sentence.claim_ids.filter((id) => !eligibleKeys.has(id));
      if (bad.length > 0) {
        dropped.push({ heading: section.heading, text, reason: `cites ${bad.join(", ")}, which ${bad.length === 1 ? "is" : "are"} not eligible` });
        return false;
      }
      return true;
    });
    if (sentences.length > 0) kept.push({ heading: section.heading, sentences });
  }
  return { sections: kept, dropped };
}

/** Renders the brief body. The footer states how many statements were withheld, never their content. */
export function renderBriefMarkdown(title: string, sections: readonly BriefSection[], withheldCount: number): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const section of sections) {
    lines.push(`## ${section.heading}`, "");
    for (const sentence of section.sentences) {
      lines.push(`- ${sentence.text} [${sentence.claim_ids.join(", ")}]`);
    }
    lines.push("");
  }
  lines.push("---", "");
  lines.push(
    withheldCount === 0
      ? "No statements were withheld by compliance."
      : `${withheldCount} statement${withheldCount === 1 ? "" : "s"} withheld by compliance.`,
  );
  lines.push("");
  return lines.join("\n");
}

// ── Release check (§12.4) ───────────────────────────────────────────────────

export interface ReleaseCheckInput {
  actorRole: Role;
  audience: string;
  expectedBriefVersion: number;
  brief: { version: number; status: BriefStatus; contentHash: string; label: string };
  /** The newest approval for this brief, stale or not. */
  latestApproval: { briefHash: string; audience: string; stale: boolean; staleReason: string | null } | null;
  caseStatus: string;
  /** From `reviewBlockers`: open findings, stale decisions, processing issues, attestation. */
  reviewBlockers: { code: string; message: string; ref?: string }[];
  /** Cited claims that are not eligible. */
  ineligibleCitations: { claimKey: string; detail: string }[];
  /** Dependents that the in-transaction staleness pass just turned stale. */
  newlyStale: { dependent: string; reason: string }[];
  /** What `findLeaks` found when comparing the summary with every hidden passage. */
  leaks: { passage: string; kind: string; detail: string }[];
}

export interface ReleaseFailure {
  code:
    | "ROLE_NOT_ALLOWED"
    | "VERSION_CONFLICT"
    | "BRIEF_NOT_APPROVED"
    | "APPROVAL_MISSING"
    | "APPROVAL_STALE"
    | "BRIEF_HASH_MISMATCH"
    | "WRONG_AUDIENCE"
    | "CASE_NOT_APPROVED"
    | "PROCESSING_ISSUE_OPEN"
    | "FINDING_OPEN"
    | "DECISION_STALE"
    | "ATTESTATION_MISSING"
    | "ATTESTATION_STALE"
    | "NO_TRANSCRIPT"
    | "CLAIM_NOT_ELIGIBLE"
    | "STALE_DEPENDENCY"
    | "SUMMARY_LEAK";
  message: string;
  ref?: string;
}

/**
 * Every check runs and every failure is listed, so the reviewer sees the whole
 * red checklist at once rather than fixing one item per attempt.
 */
export function checkRelease(input: ReleaseCheckInput): ReleaseFailure[] {
  const failures: ReleaseFailure[] = [];
  if (input.actorRole !== "reviewer" && input.actorRole !== "senior_reviewer") {
    failures.push({ code: "ROLE_NOT_ALLOWED", message: `a ${input.actorRole.replaceAll("_", " ")} cannot release a brief` });
  }
  if (input.brief.version !== input.expectedBriefVersion) {
    failures.push({ code: "VERSION_CONFLICT", message: `the brief changed since you loaded it (expected version ${input.expectedBriefVersion}, now ${input.brief.version})` });
  }
  if (input.brief.status !== "approved") {
    failures.push({ code: "BRIEF_NOT_APPROVED", message: `${input.brief.label} is ${input.brief.status}, not approved` });
  }
  const approval = input.latestApproval;
  if (!approval) {
    failures.push({ code: "APPROVAL_MISSING", message: `${input.brief.label} has no approval` });
  } else {
    if (approval.stale) {
      failures.push({ code: "APPROVAL_STALE", message: `approval stale: ${approval.staleReason ?? "evidence changed since approval"}` });
    }
    if (approval.briefHash !== input.brief.contentHash) {
      failures.push({ code: "BRIEF_HASH_MISMATCH", message: "the approved hash does not match the brief's current content" });
    }
    if (approval.audience !== input.audience) {
      failures.push({ code: "WRONG_AUDIENCE", message: `approved for audience "${approval.audience}", not "${input.audience}"` });
    }
  }
  if (input.caseStatus !== "APPROVED") {
    failures.push({ code: "CASE_NOT_APPROVED", message: `the case is ${input.caseStatus}, not APPROVED` });
  }
  for (const b of input.reviewBlockers) {
    failures.push({ code: b.code as ReleaseFailure["code"], message: b.message, ref: b.ref });
  }
  for (const c of input.ineligibleCitations) {
    failures.push({ code: "CLAIM_NOT_ELIGIBLE", message: `the brief cites ${c.claimKey}, which is not eligible: ${c.detail}`, ref: c.claimKey });
  }
  for (const s of input.newlyStale) {
    failures.push({ code: "STALE_DEPENDENCY", message: `${s.dependent} went stale during the release check: ${s.reason}` });
  }
  // The message names the passage and what kind of thing leaked, never the matched text, so two
  // figures from one passage are one line.
  const leakMessages = new Set<string>();
  for (const l of input.leaks) {
    const message = `the summary repeats a ${l.kind} from hidden passage ${l.passage}`;
    if (leakMessages.has(message)) continue;
    leakMessages.add(message);
    failures.push({ code: "SUMMARY_LEAK", message, ref: l.passage });
  }
  return failures;
}
