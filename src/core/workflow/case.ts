/**
 * The case workflow (§9.3). Fixed code.
 *
 *   INTAKE → ANALYZING → IN_REVIEW → READY_FOR_APPROVAL → APPROVED → RELEASED
 *   plus ANALYSIS_FAILED and STALE.
 */

export const CASE_STATUSES = ["INTAKE", "ANALYZING", "ANALYSIS_FAILED", "IN_REVIEW", "READY_FOR_APPROVAL", "APPROVED", "RELEASED", "STALE"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export type CaseEvent =
  | "ANALYSIS_STARTED"
  | "ANALYSIS_SUCCEEDED"
  | "ANALYSIS_FAILED"
  | "REVIEW_COMPLETE" // every readiness condition holds
  | "REVIEW_INCOMPLETE" // a readiness condition no longer holds
  | "BRIEF_APPROVED"
  | "APPROVAL_VOIDED" // the brief was edited, voiding its approval
  | "BRIEF_RELEASED"
  | "EVIDENCE_CHANGED" // a dependency of an approval or release went stale
  | "REEVALUATED";

export type CaseTransition = { ok: true; next: CaseStatus; changed: boolean } | { ok: false; message: string };

const to = (next: CaseStatus, from: CaseStatus): CaseTransition => ({ ok: true, next, changed: next !== from });

export function transitionCase(status: CaseStatus, event: CaseEvent): CaseTransition {
  switch (event) {
    case "ANALYSIS_STARTED":
      // An approved or released case with new evidence is STALE, not merely "analyzing":
      // exposure may already have occurred and the UI must keep saying so.
      if (status === "APPROVED" || status === "RELEASED" || status === "STALE") return to("STALE", status);
      return to("ANALYZING", status);
    case "ANALYSIS_SUCCEEDED":
      if (status === "ANALYZING" || status === "ANALYSIS_FAILED" || status === "STALE" || status === "INTAKE") return to("IN_REVIEW", status);
      return to(status, status);
    case "ANALYSIS_FAILED":
      if (status === "ANALYZING" || status === "INTAKE") return to("ANALYSIS_FAILED", status);
      return to(status, status);
    case "REVIEW_COMPLETE":
      if (status === "IN_REVIEW") return to("READY_FOR_APPROVAL", status);
      return to(status, status);
    case "REVIEW_INCOMPLETE":
      if (status === "READY_FOR_APPROVAL") return to("IN_REVIEW", status);
      if (status === "APPROVED" || status === "RELEASED") return to("STALE", status);
      return to(status, status);
    case "BRIEF_APPROVED":
      if (status !== "READY_FOR_APPROVAL") return { ok: false, message: `a brief can only be approved when the case is READY_FOR_APPROVAL (it is ${status})` };
      return to("APPROVED", status);
    case "APPROVAL_VOIDED":
      if (status === "APPROVED") return to("READY_FOR_APPROVAL", status);
      return to(status, status);
    case "BRIEF_RELEASED":
      if (status !== "APPROVED") return { ok: false, message: `a brief can only be released when the case is APPROVED (it is ${status})` };
      return to("RELEASED", status);
    case "EVIDENCE_CHANGED":
      if (status === "APPROVED" || status === "RELEASED") return to("STALE", status);
      return to(status, status);
    case "REEVALUATED":
      if (status === "STALE") return to("IN_REVIEW", status);
      return to(status, status);
  }
}

// ── Review readiness ────────────────────────────────────────────────────────

export interface ReadinessFinding {
  id: string;
  label: string; // "F1"
  state: string;
  /** The latest disposition decision, if any. */
  decision: { stale: boolean; outcome: string | null } | null;
}

export interface ReadinessInput {
  findings: ReadinessFinding[];
  openBlockingIssues: { code: string; message: string }[];
  /** The newest whole-call attestation on the case, whichever transcript version it covers. */
  attestation: { stale: boolean; transcriptVersionId: string } | null;
  currentTranscriptVersionId: string | null;
  currentTranscriptLabel: string; // "transcript v2"
}

export interface ReadinessBlocker {
  code: "FINDING_OPEN" | "DECISION_STALE" | "PROCESSING_ISSUE_OPEN" | "ATTESTATION_MISSING" | "ATTESTATION_STALE" | "NO_TRANSCRIPT";
  message: string;
  ref?: string;
}

/**
 * IN_REVIEW → READY_FOR_APPROVAL requires: every finding DISPOSITIONED with a
 * non-stale decision, no open blocking processing issues, and a non-stale
 * whole-call attestation for the current transcript version — even when
 * there are zero findings.
 */
export function reviewBlockers(input: ReadinessInput): ReadinessBlocker[] {
  const blockers: ReadinessBlocker[] = [];
  if (!input.currentTranscriptVersionId) {
    blockers.push({ code: "NO_TRANSCRIPT", message: "no transcript has been uploaded" });
  }
  for (const f of input.findings) {
    if (f.state !== "DISPOSITIONED") {
      blockers.push({ code: "FINDING_OPEN", message: `finding ${f.label} is ${f.state}, not dispositioned`, ref: f.id });
    } else if (!f.decision || f.decision.stale) {
      blockers.push({ code: "DECISION_STALE", message: `finding ${f.label}: its decision is stale and must be made again`, ref: f.id });
    }
  }
  for (const issue of input.openBlockingIssues) {
    blockers.push({ code: "PROCESSING_ISSUE_OPEN", message: `blocking processing issue ${issue.code}: ${issue.message}` });
  }
  if (!input.attestation) {
    blockers.push({ code: "ATTESTATION_MISSING", message: `no whole-call attestation for ${input.currentTranscriptLabel}` });
  } else if (input.attestation.stale || input.attestation.transcriptVersionId !== input.currentTranscriptVersionId) {
    // An attestation covers the turns of one transcript version; a newer version must be attested again.
    blockers.push({ code: "ATTESTATION_STALE", message: `attestation stale: ${input.currentTranscriptLabel}` });
  }
  return blockers;
}
