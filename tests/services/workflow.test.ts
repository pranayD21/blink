/**
 * §18.1 Workflow: who may decide what, optimistic concurrency, clarification,
 * and what an analyst is never allowed to read.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "@/server/audit/log";
import { getDb, transact } from "@/server/db/client";
import { decisions, findingPassages, monitorInstances } from "@/server/db/schema";
import { newId } from "@/server/ids";
import { attestCase } from "@/server/services/attestations";
import { briefWorkspace, editBrief, getBrief, releasedBriefs, requestBriefDraft } from "@/server/services/briefs";
import { listCases } from "@/server/services/cases";
import { correctClaim } from "@/server/services/claims";
import { addClarificationTask, applyFindingAction, createReviewerFinding, getFinding } from "@/server/services/findings";
import { createFinding } from "@/server/services/findingsCore";
import { currentClaimByKey, currentTranscript, loadCurrentClaims, turnsOfVersion } from "@/server/services/loaders";
import { releaseBrief } from "@/server/services/release";
import { loadWorkspace } from "@/server/services/workspace";
import { CASE, G1, G2, G3, RATIONALE, answerMarginClarification, appError, approve, attest, completeReview, dispose, draftTemplate, escalate, findingOn, findingsOf, openTasks, release, seedAnalyzed, statusOf, user } from "../helpers/db";

beforeEach(seedAnalyzed);

describe("escalation", () => {
  it("a reviewer cannot dispose a finding the policy escalated; a senior reviewer can", () => {
    const f1 = findingOn(G1);
    const err = appError(() => dispose(f1.id, "restricted_exclude", "marcus"));
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/only a senior reviewer/);
    expect(getFinding(getDb(), f1.id).state).toBe("REVIEW_REQUIRED");

    const { finding, decisionId } = dispose(f1.id, "restricted_escalate_to_legal", "jordan");
    expect(finding.state).toBe("DISPOSITIONED");
    const decision = getDb().select().from(decisions).where(eq(decisions.id, decisionId!)).get()!;
    expect(decision).toMatchObject({ kind: "escalation_decision", outcome: "restricted_escalate_to_legal", actorId: "user_jordan", stale: false });
    expect(openTasks(f1.id)).toEqual([]);
  });

  it("a reviewer can escalate a finding themselves; after that only a senior reviewer decides it", () => {
    const f2 = findingOn(G2);
    expect(escalate(f2.id, "marcus").finding.state).toBe("ESCALATED");
    expect(openTasks(f2.id, "escalation")).toHaveLength(1);
    expect(appError(() => dispose(f2.id, "restricted_exclude", "marcus")).status).toBe(403);
    expect(dispose(f2.id, "restricted_exclude", "jordan").finding.state).toBe("DISPOSITIONED");
  });

  it("only a senior reviewer may record restricted_escalate_to_legal", () => {
    const err = appError(() => dispose(findingOn(G2).id, "restricted_escalate_to_legal", "marcus"));
    expect(err.status).toBe(403);
  });

  it("a disposition needs a real rationale", () => {
    const err = appError(() => dispose(findingOn(G2).id, "restricted_exclude", "marcus", "ok"));
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/at least 20 characters/);
  });
});

describe("optimistic concurrency", () => {
  it("a dispose with a stale expectedVersion is refused with 409 and changes nothing", () => {
    const f2 = findingOn(G2);
    const loadedVersion = f2.version;
    // Another reviewer acts first.
    escalate(f2.id, "marcus");
    const err = appError(() => transact((tx) => applyFindingAction(tx, f2.id, { type: "DISPOSE", outcome: "restricted_exclude", rationale: RATIONALE, expectedVersion: loadedVersion }, user("jordan"))));
    expect(err.status).toBe(409);
    expect(err.code).toBe("VERSION_CONFLICT");
    expect(getFinding(getDb(), f2.id).state).toBe("ESCALATED");
  });

  it("a claim correction against an old claim version is refused with 409", () => {
    const claim = currentClaimByKey(getDb(), CASE, G3)!;
    transact((tx) => correctClaim(tx, claim.id, { verified: { knowledge_basis: "public_source" }, clear: [], note: "", expectedVersion: claim.versionNo }, user("marcus")));
    const err = appError(() => transact((tx) => correctClaim(tx, claim.id, { verified: { knowledge_basis: "speculation" }, clear: [], note: "", expectedVersion: claim.versionNo }, user("marcus"))));
    expect(err.status).toBe(409);
  });
});

describe("clarification (§10.6)", () => {
  it("a finding waiting for context cannot be dispositioned directly", () => {
    const err = appError(() => dispose(findingOn(G3).id, "no_concern", "marcus"));
    expect(err.status).toBe(422);
    expect(err.message).toMatch(/waiting for context/);
  });

  it("answering maps onto a verified field, re-runs the monitors, and leaves the decision to a person", () => {
    const before = currentClaimByKey(getDb(), CASE, G3)!;
    const result = answerMarginClarification();
    expect(result.claimVersion).toBe(before.versionNo + 1);

    const claim = loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === G3)!;
    // The expert's words are kept; the reviewer's value sits beside them.
    expect(claim.record.asserted.knowledge_basis).toBe("unstated");
    expect(claim.record.verified).toEqual({ knowledge_basis: "public_source" });
    expect(claim.row.status).toBe("reviewer_corrected");

    const r1 = getDb().select().from(monitorInstances).where(eq(monitorInstances.caseId, CASE)).all().find((i) => i.claimLogicalKey === G3 && i.ruleId === "R1")!;
    expect(r1.state).toBe("NOT_TRIGGERED");
    // Not a clearance: the finding waits for a person to acknowledge it.
    const finding = findingOn(G3);
    expect(finding.state).toBe("NOT_TRIGGERED_PENDING_ACK");
    expect(openTasks(finding.id, "context")).toEqual([]);

    const restricted = appError(() => dispose(finding.id, "restricted_exclude", "marcus"));
    expect(restricted.status).toBe(422);
    expect(dispose(finding.id, "no_concern", "marcus").finding.state).toBe("DISPOSITIONED");
  });

  it("a reviewer can add their own clarification question and promote a finding to review", () => {
    const finding = findingOn(G3);
    const task = transact((tx) => addClarificationTask(tx, finding.id, "Which earnings call was the expert referring to?", user("marcus")));
    expect(task.kind).toBe("clarification");
    const promoted = transact((tx) => applyFindingAction(tx, finding.id, { type: "PROMOTE", rationale: "The source cannot be confirmed; treat as review.", expectedVersion: finding.version }, user("marcus")));
    expect(promoted.finding.state).toBe("REVIEW_REQUIRED");
    expect(openTasks(finding.id, "review")).toHaveLength(1);
    expect(openTasks(finding.id, "clarification")).toEqual([]);
  });
});

describe("review completion (§9.3)", () => {
  it("every finding dispositioned plus a whole-call attestation makes the case READY_FOR_APPROVAL", () => {
    answerMarginClarification();
    dispose(findingOn(G3).id, "no_concern", "marcus");
    dispose(findingOn(G2).id, "restricted_exclude", "marcus");
    dispose(findingOn(G1).id, "restricted_escalate_to_legal", "jordan");
    for (const f of findingsOf().filter((f) => f.origin === "ai_suggested")) dispose(f.id, "no_concern", "marcus");
    expect(findingsOf().every((f) => f.state === "DISPOSITIONED")).toBe(true);
    // Still not ready: nobody has attested to the whole call.
    expect(statusOf()).toBe("IN_REVIEW");
    expect(attest().status).toBe("READY_FOR_APPROVAL");
    expect(verifyAuditChain(getDb())).toMatchObject({ ok: true });
  });

  it("attesting to a transcript version that is not current is refused", () => {
    const err = appError(() => transact((tx) => attestCase(tx, CASE, { transcriptVersionId: "tv_not_current" }, user("marcus"))));
    expect(err.status).toBe(422);
    expect(err.code).toBe("TRANSCRIPT_CHANGED");
  });

  it("a reviewer-created finding reopens a completed review", () => {
    completeReview();
    expect(statusOf()).toBe("READY_FOR_APPROVAL");
    const created = transact((tx) => createReviewerFinding(tx, { caseId: CASE, title: "Expert named a second customer", severity: "medium", explanation: "Worth a second look at T15.", claimLogicalKey: null, turnLabel: "T15" }, user("marcus")));
    expect(created.origin).toBe("reviewer");
    expect(created.state).toBe("REVIEW_REQUIRED");
    expect(statusOf()).toBe("IN_REVIEW");
  });

  it("a decision goes stale when its claim is corrected afterwards, and the finding reopens", () => {
    const f2 = findingOn(G2);
    const { decisionId } = dispose(f2.id, "restricted_exclude", "marcus");
    const claim = currentClaimByKey(getDb(), CASE, G2)!;
    transact((tx) => correctClaim(tx, claim.id, { verified: { knowledge_basis: "insider_conversation" }, clear: [], note: "confirmed with the analyst", expectedVersion: claim.versionNo }, user("marcus")));
    const decision = getDb().select().from(decisions).where(eq(decisions.id, decisionId!)).get()!;
    expect(decision.stale).toBe(true);
    expect(decision.staleReason).toMatch(/claim changed \(C7 · T15\)/);
    expect(getFinding(getDb(), f2.id).state).toBe("REVIEW_REQUIRED");
    expect(openTasks(f2.id, "review")).toHaveLength(1);
  });
});

describe("what is hidden from the banker, as compliance sees it (live guidance, section 5)", () => {
  const view = (id: string) => loadWorkspace(getDb(), CASE, user("marcus")).findings.find((f) => f.id === id)!;

  it("every undecided finding is hidden until compliance decides", () => {
    const all = loadWorkspace(getDb(), CASE, user("marcus")).findings;
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) expect(f.hidden).toBe("until_decided");
  });

  it("keeping a finding hidden and clearing one are told apart", () => {
    const f2 = findingOn(G2);
    const f3 = findingOn(G3);
    dispose(f2.id, "restricted_exclude", "marcus");
    answerMarginClarification();
    dispose(f3.id, "no_concern", "marcus");
    expect(view(f2.id).hidden).toBe("kept_hidden");
    expect(view(f3.id).hidden).toBe("shown_on_release");
    expect(view(findingOn(G1).id).hidden).toBe("until_decided");
  });

  it("a decision gone stale hides the finding again until it is re-decided", () => {
    const f2 = findingOn(G2);
    dispose(f2.id, "no_concern", "marcus");
    expect(view(f2.id).hidden).toBe("shown_on_release");
    const claim = currentClaimByKey(getDb(), CASE, G2)!;
    transact((tx) => correctClaim(tx, claim.id, { verified: { knowledge_basis: "insider_conversation" }, clear: [], note: "confirmed with the analyst", expectedVersion: claim.versionNo }, user("marcus")));
    expect(view(f2.id).hidden).toBe("until_decided");
  });

  it("a live finding is listed with the words it hid, and has no claim", () => {
    const text = transact((tx) => {
      const turn = turnsOfVersion(tx, currentTranscript(tx, CASE)!.id).find((t) => t.label === "T7")!;
      const { finding } = createFinding(tx, { caseId: CASE, claimLogicalKey: null, origin: "live", title: "Flagged during the call", severity: "high", state: "REVIEW_REQUIRED", reasonCodes: ["LIVE_ONLY", "TURN:T7"], dedupeKey: "live-test:T7", createdBy: "system" });
      tx.insert(findingPassages).values({ id: newId("fp"), findingId: finding.id, turnId: turn.id, startChar: 0, endChar: 12 }).run();
      return { id: finding.id, words: turn.text.slice(0, 12) };
    });
    const live = view(text.id);
    expect(live.origin).toBe("live");
    expect(live.hidden).toBe("until_decided");
    expect(live.passages).toEqual([{ turnLabel: "T7", text: text.words }]);
    expect(view(findingOn(G2).id).passages).toEqual([]);
    dispose(text.id, "restricted_exclude", "marcus");
    expect(view(text.id).hidden).toBe("kept_hidden");
  });
});

describe("what an analyst may never read (§14)", () => {
  it("the review workspace, findings, and finding actions are 403 for an analyst", () => {
    const priya = user("priya");
    expect(appError(() => loadWorkspace(getDb(), CASE, priya)).status).toBe(403);
    expect(appError(() => dispose(findingOn(G2).id, "no_concern", "priya")).status).toBe(403);
    expect(appError(() => transact((tx) => createReviewerFinding(tx, { caseId: CASE, title: "Something", severity: "low", explanation: "x", claimLogicalKey: null, turnLabel: null }, priya))).status).toBe(403);
    expect(appError(() => transact((tx) => attestCase(tx, CASE, { transcriptVersionId: currentTranscript(tx, CASE)!.id }, priya))).status).toBe(403);
  });

  it("an unreleased brief is 403 for an analyst, and the analyst list shows released briefs only", () => {
    completeReview();
    const brief = draftTemplate();
    const priya = user("priya");
    expect(appError(() => briefWorkspace(getDb(), CASE, priya)).status).toBe(403);
    expect(appError(() => transact((tx) => requestBriefDraft(tx, CASE, "template", priya))).status).toBe(403);
    expect(appError(() => transact((tx) => editBrief(tx, brief.id, { sections: [], expectedVersion: 1 }, priya))).status).toBe(403);
    expect(appError(() => transact((tx) => releaseBrief(tx, brief.id, { audience: "analyst", expectedVersion: 1 }, priya))).status).toBe(403);
    expect(releasedBriefs(getDb())).toEqual([]);

    approve(brief.id);
    expect(releasedBriefs(getDb())).toEqual([]);
    expect(release(brief.id)).toMatchObject({ released: true });
    const visible = releasedBriefs(getDb());
    expect(visible).toHaveLength(1);
    expect(visible[0].standing).toBe("current");
  });

  it("the case list gives an analyst statuses but no finding counts", () => {
    const forAnalyst = listCases(getDb(), user("priya"))[0];
    const forReviewer = listCases(getDb(), user("marcus"))[0];
    expect(forAnalyst.status).toBe("IN_REVIEW");
    expect(forAnalyst.findingCounts).toBeNull();
    expect(forReviewer.findingCounts).toMatchObject({ REVIEW_REQUIRED: 3, NEEDS_CONTEXT: 1 });
  });

  it("a released brief never carries a restricted claim, and says how many statements were withheld", () => {
    completeReview();
    const brief = draftTemplate();
    approve(brief.id);
    release(brief.id);
    const [visible] = releasedBriefs(getDb());
    const cited = visible.citations.map((c) => c.key);
    expect(cited).not.toContain(G1);
    expect(cited).not.toContain(G2);
    expect(cited).toContain(G3);
    expect(visible.withheldCount).toBe(2);
    expect(getBrief(getDb(), brief.id).bodyMd).toMatch(/2 statements withheld by compliance/);
    const text = JSON.stringify(visible);
    expect(text).not.toMatch(/Cardinal/);
    expect(text).not.toMatch(/dashboard/i);
  });
});
