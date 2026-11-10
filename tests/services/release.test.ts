/**
 * §18.1 Release and staleness: every release condition is re-checked on the
 * server and each failure is named; a corrected transcript reopens exactly
 * what depended on the changed turn.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { listAudit, verifyAuditChain } from "@/server/audit/log";
import { getDb, transact } from "@/server/db/client";
import { approvals, attestations, briefs, decisions, processingIssues } from "@/server/db/schema";
import { newId } from "@/server/ids";
import { approveBrief, briefWorkspace, editBrief, getBrief, releasedBriefs } from "@/server/services/briefs";
import { latestAttestation } from "@/server/services/caseStatus";
import { createReviewerFinding } from "@/server/services/findings";
import { loadCurrentClaims } from "@/server/services/loaders";
import { releaseBrief } from "@/server/services/release";
import { CASE, G1, G2, G3, STEEL, appError, approve, attest, completeReview, draftTemplate, findingOn, findingsOf, release, reviewAndApprove, seedAnalyzed, statusOf, uploadV2, user } from "../helpers/db";

beforeEach(seedAnalyzed);

const codes = (result: ReturnType<typeof release>) => (result.released ? [] : result.failures.map((f) => f.code));
const messages = (result: ReturnType<typeof release>) => (result.released ? [] : result.failures.map((f) => f.message));

describe("brief approval (§9.4)", () => {
  it("approving needs the exact content hash", () => {
    completeReview();
    const brief = draftTemplate();
    const err = appError(() => transact((tx) => approveBrief(tx, brief.id, { briefHash: "0".repeat(64), audience: "analyst", expectedVersion: brief.version }, user("marcus"))));
    expect(err.status).toBe(409);
    expect(err.code).toBe("BRIEF_HASH_MISMATCH");
    expect(statusOf()).toBe("READY_FOR_APPROVAL");
  });

  it("approval is refused while the review is incomplete", () => {
    const brief = draftTemplate();
    const err = appError(() => approve(brief.id));
    expect(err.status).toBe(422);
    expect(err.code).toBe("REVIEW_INCOMPLETE");
  });

  it("editing the text creates a new version with a new hash and voids the approval", () => {
    const approved = reviewAndApprove();
    expect(statusOf()).toBe("APPROVED");
    const sections = briefWorkspace(getDb(), CASE, user("marcus")).brief!.sections;
    sections[0].sentences[0].text = `${sections[0].sentences[0].text} (edited)`;
    const edited = transact((tx) => editBrief(tx, approved.id, { sections, expectedVersion: approved.version }, user("marcus")));

    expect(edited.versionNo).toBe(approved.versionNo + 1);
    expect(edited.contentHash).not.toBe(approved.contentHash);
    expect(edited.status).toBe("draft");
    expect(getBrief(getDb(), approved.id).status).toBe("stale");
    expect(getDb().select().from(approvals).where(eq(approvals.briefId, approved.id)).all().every((a) => a.stale)).toBe(true);
    expect(statusOf()).toBe("READY_FOR_APPROVAL");
    // The old version can no longer be released.
    expect(codes(release(approved.id))).toEqual(expect.arrayContaining(["BRIEF_NOT_APPROVED", "APPROVAL_STALE", "CASE_NOT_APPROVED"]));
  });

  it("an edit may not cite a restricted claim or leave a sentence uncited", () => {
    completeReview();
    const brief = draftTemplate();
    const restricted = appError(() => transact((tx) => editBrief(tx, brief.id, { sections: [{ heading: "Halvorsen", sentences: [{ text: "West region bookings are down twenty percent.", claim_ids: [G1] }] }], expectedVersion: brief.version }, user("marcus"))));
    expect(restricted.status).toBe(422);
    const uncited = appError(() => transact((tx) => editBrief(tx, brief.id, { sections: [{ heading: "Halvorsen", sentences: [{ text: "Demand is weak.", claim_ids: [] }] }], expectedVersion: brief.version }, user("marcus"))));
    expect(uncited.status).toBe(422);
  });
});

describe("release check (§12.4): each failure is named", () => {
  it("succeeds when everything holds, and records the release", () => {
    const brief = reviewAndApprove();
    const result = release(brief.id);
    expect(result).toMatchObject({ released: true, briefHash: brief.contentHash });
    expect(statusOf()).toBe("RELEASED");
    expect(getBrief(getDb(), brief.id).status).toBe("released");
    expect(listAudit(getDb(), CASE).some((e) => e.type === "BRIEF_RELEASED")).toBe(true);
  });

  it("wrong audience → WRONG_AUDIENCE", () => {
    const brief = reviewAndApprove();
    const result = release(brief.id, "investment_team");
    expect(codes(result)).toEqual(["WRONG_AUDIENCE"]);
    expect(statusOf()).toBe("APPROVED");
    expect(listAudit(getDb(), CASE).at(-1)!.type).toBe("RELEASE_BLOCKED");
  });

  it("brief hash mismatch → BRIEF_HASH_MISMATCH", () => {
    const brief = reviewAndApprove();
    // The stored text is changed behind the workflow's back.
    getDb().update(briefs).set({ contentHash: "f".repeat(64) }).where(eq(briefs.id, brief.id)).run();
    const result = release(brief.id);
    expect(codes(result)).toContain("BRIEF_HASH_MISMATCH");
    // The approval depended on the brief's hash, so the same check also marks it stale.
    expect(codes(result)).toContain("APPROVAL_STALE");
    expect(statusOf()).not.toBe("RELEASED");
    expect(releasedBriefs(getDb())).toEqual([]);
  });

  it("open finding → FINDING_OPEN", () => {
    const brief = reviewAndApprove();
    transact((tx) => createReviewerFinding(tx, { caseId: CASE, title: "Second look at T9", severity: "low", explanation: "Raised after approval.", claimLogicalKey: null, turnLabel: "T9" }, user("jordan")));
    const result = release(brief.id);
    expect(codes(result)).toEqual(expect.arrayContaining(["FINDING_OPEN", "CASE_NOT_APPROVED"]));
    expect(result.released).toBe(false);
  });

  it("missing attestation → ATTESTATION_MISSING", () => {
    const brief = reviewAndApprove();
    getDb().delete(attestations).where(eq(attestations.caseId, CASE)).run();
    expect(codes(release(brief.id))).toContain("ATTESTATION_MISSING");
  });

  it("blocking processing issue → PROCESSING_ISSUE_OPEN", () => {
    const brief = reviewAndApprove();
    getDb().insert(processingIssues).values({ id: newId("iss"), caseId: CASE, runId: null, severity: "blocking", code: "QUOTE_NOT_FOUND", message: "a quote could not be located in the transcript", refJson: "{}", resolved: false, createdAt: new Date().toISOString() }).run();
    expect(codes(release(brief.id))).toContain("PROCESSING_ISSUE_OPEN");
  });

  it("stale approval → APPROVAL_STALE", () => {
    const brief = reviewAndApprove();
    getDb().update(approvals).set({ stale: true, staleReason: "claim changed (C9 · T19)" }).where(eq(approvals.briefId, brief.id)).run();
    const result = release(brief.id);
    expect(codes(result)).toContain("APPROVAL_STALE");
    expect(messages(result)).toContain("approval stale: claim changed (C9 · T19)");
  });

  it("a stale expectedVersion → VERSION_CONFLICT, and an analyst is refused outright", () => {
    const brief = reviewAndApprove();
    const result = transact((tx) => releaseBrief(tx, brief.id, { audience: "analyst", expectedVersion: brief.version - 1 }, user("marcus")));
    expect(codes(result)).toEqual(["VERSION_CONFLICT"]);
    expect(appError(() => release(brief.id, "analyst", "priya")).status).toBe(403);
  });

  it("an unapproved draft cannot be released", () => {
    completeReview();
    const brief = draftTemplate();
    expect(codes(release(brief.id))).toEqual(expect.arrayContaining(["BRIEF_NOT_APPROVED", "APPROVAL_MISSING", "CASE_NOT_APPROVED"]));
  });
});

describe("transcript v2: a correction to T19 (§12.3, demo steps 8–9)", () => {
  it("before release: only the brief approval and the attestation go stale; F1–F3 decisions stay fresh", async () => {
    const brief = reviewAndApprove();
    const decisionsBefore = getDb().select().from(decisions).where(eq(decisions.caseId, CASE)).all();
    const steelBefore = loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === STEEL)!;

    await uploadV2();

    // The claim that quotes T19 is revised; every other claim is carried over unchanged.
    const claims = loadCurrentClaims(getDb(), CASE);
    const steel = claims.find((c) => c.row.logicalKey === STEEL)!;
    expect(steel.row.versionNo).toBe(steelBefore.row.versionNo + 1);
    expect(steel.row.contentHash).not.toBe(steelBefore.row.contentHash);
    expect(steel.fields.value?.number).toBe(21);
    expect(claims.filter((c) => c.row.logicalKey !== STEEL).every((c) => c.row.versionNo === 1 || c.row.logicalKey === G3)).toBe(true);

    // Decisions on F1–F3 (and the AI-suggested concern) do not depend on T19.
    const decisionsAfter = getDb().select().from(decisions).where(eq(decisions.caseId, CASE)).all();
    expect(decisionsAfter).toHaveLength(decisionsBefore.length);
    expect(decisionsAfter.every((d) => !d.stale)).toBe(true);
    for (const key of [G1, G2, G3]) expect(findingOn(key).state).toBe("DISPOSITIONED");
    expect(findingsOf().every((f) => f.state === "DISPOSITIONED")).toBe(true);

    // The approval cited the changed claim; the attestation depends on every turn.
    const approval = getDb().select().from(approvals).where(eq(approvals.briefId, brief.id)).get()!;
    expect(approval.stale).toBe(true);
    expect(approval.staleReason).toBe("claim changed (C9 · T19)");
    const attestation = latestAttestation(getDb(), CASE)!;
    expect(attestation.stale).toBe(true);
    expect(attestation.staleReason).toMatch(/T19/);
    expect(getBrief(getDb(), brief.id).status).toBe("stale");
    expect(statusOf()).toBe("IN_REVIEW");

    // The release attempt lists both reasons.
    const result = release(brief.id);
    expect(result.released).toBe(false);
    expect(codes(result)).toEqual(expect.arrayContaining(["APPROVAL_STALE", "ATTESTATION_STALE", "BRIEF_NOT_APPROVED", "CASE_NOT_APPROVED"]));
    expect(messages(result)).toContain("approval stale: claim changed (C9 · T19)");
    expect(messages(result)).toContain("attestation stale: transcript v2");
  });

  it("after release: the analyst's copy is marked under re-review; re-attest, redraft, approve, release succeeds", async () => {
    const v1 = reviewAndApprove();
    expect(release(v1.id)).toMatchObject({ released: true });
    expect(releasedBriefs(getDb())[0].standing).toBe("current");

    await uploadV2();
    expect(statusOf()).toBe("IN_REVIEW");
    // Exposure already happened: the released brief stays visible, flagged, not silently withdrawn.
    const flagged = releasedBriefs(getDb())[0];
    expect(flagged.standing).toBe("under_re_review");
    expect(flagged.staleReason).toBe("claim changed (C9 · T19)");
    expect(codes(release(v1.id))).toEqual(expect.arrayContaining(["APPROVAL_STALE", "ATTESTATION_STALE"]));

    // The old text quotes the old number, so it cannot simply be approved again.
    const outdated = appError(() => approve(v1.id));
    expect([409, 422]).toContain(outdated.status);

    expect(attest().status).toBe("READY_FOR_APPROVAL");
    const v2 = draftTemplate();
    expect(v2.versionNo).toBe(2);
    expect(v2.bodyMd).toMatch(/twenty-one percent/);
    approve(v2.id);
    expect(release(v2.id)).toMatchObject({ released: true });
    expect(statusOf()).toBe("RELEASED");

    const visible = releasedBriefs(getDb());
    expect(visible.map((b) => [b.versionNo, b.standing])).toEqual([
      [2, "current"],
      [1, "superseded"],
    ]);
    expect(verifyAuditChain(getDb())).toMatchObject({ ok: true });
  });

  it("uploading identical text is refused: there is nothing to re-analyze", async () => {
    await uploadV2();
    await expect(uploadV2()).rejects.toMatchObject({ status: 409, code: "TRANSCRIPT_UNCHANGED" });
  });
});
