/**
 * §18.1 Release and staleness: every release condition is re-checked on the
 * server and each failure is named; a corrected transcript reopens exactly
 * what depended on the changed turn.
 */
import { desc, eq } from "drizzle-orm";
import { sha256Hex } from "@/core/deps/hash";
import { type RedactedTurn, redactTurns } from "@/core/release/redact";
import { beforeEach, describe, expect, it } from "vitest";
import { listAudit, verifyAuditChain } from "@/server/audit/log";
import { getDb, transact } from "@/server/db/client";
import { approvals, attestations, briefs, claimQuotes, claims, decisions, findingPassages, processingIssues, releases, turnLineage } from "@/server/db/schema";
import { newId } from "@/server/ids";
import { drainJobs } from "@/server/jobs/runner";
import { approveBrief, briefWorkspace, citationsFor, editBrief, eligibilityForCase, getBrief, releasedBriefs } from "@/server/services/briefs";
import { latestAttestation } from "@/server/services/caseStatus";
import { createReviewerFinding } from "@/server/services/findings";
import { type FindingRow, createFinding } from "@/server/services/findingsCore";
import { currentTranscript, loadCurrentClaims, turnsOfVersion } from "@/server/services/loaders";
import { type TurnPlacer, turnPlacer } from "@/server/services/placement";
import { restrictedOnCase } from "@/server/services/redaction";
import { releaseBrief } from "@/server/services/release";
import { readFixtureText } from "@/server/services/seed";
import { uploadTranscript } from "@/server/services/transcripts";
import { CASE, G1, G2, G3, STEEL, appError, approve, attest, completeReview, dispose, draftTemplate, findingOn, findingsOf, release, reviewAndApprove, seedAnalyzed, statusOf, uploadV2, user } from "../helpers/db";

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
    expect(releasedBriefs(getDb(), user("priya"))).toEqual([]);
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
    expect(releasedBriefs(getDb(), user("priya"))[0].standing).toBe("current");

    await uploadV2();
    expect(statusOf()).toBe("IN_REVIEW");
    // Exposure already happened: the released brief stays visible, flagged, not silently withdrawn.
    const flagged = releasedBriefs(getDb(), user("priya"))[0];
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

    const visible = releasedBriefs(getDb(), user("priya"));
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

describe("release snapshots the blanked transcript and refuses a leaking summary (live guidance, section 5)", () => {
  const releaseRow = () => getDb().select().from(releases).where(eq(releases.caseId, CASE)).orderBy(desc(releases.releasedAt)).get()!;

  /** A live finding on one turn of the current transcript, the way the end of a call raises one. */
  function liveFindingOn(turnLabel: string): FindingRow {
    return transact((tx) => {
      const turn = turnsOfVersion(tx, currentTranscript(tx, CASE)!.id).find((t) => t.label === turnLabel)!;
      const { finding } = createFinding(tx, { caseId: CASE, claimLogicalKey: null, origin: "live", title: "Flagged during the call", severity: "high", state: "REVIEW_REQUIRED", reasonCodes: ["LIVE_ONLY", `TURN:${turnLabel}`], dedupeKey: `live-test:${turnLabel}`, createdBy: "system" });
      tx.insert(findingPassages).values({ id: newId("fp"), findingId: finding.id, turnId: turn.id, startChar: 0, endChar: turn.text.length }).run();
      return finding;
    });
  }

  it("release stores a transcript with the restricted quotes blanked", () => {
    const brief = reviewAndApprove();
    const r = release(brief.id);
    expect(r.released).toBe(true);
    const row = releaseRow();
    const text = row.redactedTranscriptJson!;
    expect(text).not.toContain("I still have a login"); // F1 was restricted
    expect(text).not.toContain("Cardinal"); // F2 was restricted
    expect(text).toContain("well before I left"); // F3 was cleared
    expect(row.hiddenPassages).toBeGreaterThanOrEqual(2);
    expect(row.transcriptVersionId).toBe(currentTranscript(getDb(), CASE)!.id);
    expect(row.redactedTranscriptHash).toBe(sha256Hex(text));
    // The snapshot is turns of segments: a hidden run carries only its length.
    const turns = JSON.parse(text) as RedactedTurn[];
    expect(turns.find((t) => t.label === "T15")!.segments).toEqual([{ text: "Brightwater has been aggressive on price in utilities. " }, { hidden: expect.any(Number) }]);
  });

  it("a summary that repeats a restricted figure cannot be released", () => {
    completeReview();
    const draft = draftTemplate();
    const sections = briefWorkspace(getDb(), CASE, user("marcus")).brief!.sections;
    // C2 is eligible; "twenty percent" is F1's restricted figure.
    sections[0].sentences.push({ text: "Distributors are soft, with orders down about twenty percent.", claim_ids: ["C2"] });
    const edited = transact((tx) => editBrief(tx, draft.id, { sections, expectedVersion: draft.version }, user("marcus")));
    approve(edited.id);
    const result = release(edited.id);
    expect(result).toMatchObject({ released: false });
    expect(codes(result)).toContain("SUMMARY_LEAK");
    const leak = result.released ? null : result.failures.find((f) => f.code === "SUMMARY_LEAK")!;
    expect(leak!.message).toBe("the summary repeats a figure from hidden passage F1 · T5");
    expect(statusOf()).toBe("APPROVED");
    expect(getDb().select().from(releases).all()).toEqual([]);
    // The blocked attempt is audited without the hidden text.
    const blocked = listAudit(getDb(), CASE).at(-1)!;
    expect(blocked.type).toBe("RELEASE_BLOCKED");
    expect(JSON.stringify(blocked)).not.toContain("orders fell off a cliff");
  });

  it("the demo's template summary passes the leak check", () => {
    const brief = reviewAndApprove();
    expect(codes(release(brief.id))).not.toContain("SUMMARY_LEAK");
  });

  it("the snapshot does not change when a corrected transcript arrives later", async () => {
    const brief = reviewAndApprove();
    expect(release(brief.id)).toMatchObject({ released: true });
    const before = releaseRow();

    await uploadV2();

    const after = releaseRow();
    expect(after.redactedTranscriptHash).toBe(before.redactedTranscriptHash);
    expect(after.redactedTranscriptJson).toBe(before.redactedTranscriptJson);
    expect(after.transcriptVersionId).toBe(before.transcriptVersionId);
    expect(after.transcriptVersionId).not.toBe(currentTranscript(getDb(), CASE)!.id);
    expect(releasedBriefs(getDb(), user("priya"))[0].standing).toBe("under_re_review");
  });

  it("a claim on a turn that is flagged live-only is not eligible", () => {
    liveFindingOn("T7");
    const eligibility = eligibilityForCase(getDb(), CASE);
    const of = (key: string) => eligibility.claims.find((c) => c.claim.row.logicalKey === key)!.eligibility;
    expect(of("C2")).toMatchObject({ eligible: false, reason: "restricted" }); // C2 and C3 quote T7
    expect(of("C3")).toMatchObject({ eligible: false, reason: "restricted" });
    expect(of("C4")).toEqual({ eligible: true }); // T9 is not flagged
  });

  it("a live passage compliance kept hidden is blanked in the snapshot; one it cleared is shown", () => {
    const kept = liveFindingOn("T21");
    const cleared = liveFindingOn("T9");
    completeReview();
    dispose(kept.id, "restricted_exclude", "marcus");
    dispose(cleared.id, "cleared_for_research", "marcus");
    const brief = draftTemplate();
    expect(brief.sentencesJson).not.toContain("two price increases"); // C10 quotes T21
    approve(brief.id);
    expect(release(brief.id)).toMatchObject({ released: true });
    const turns = JSON.parse(releaseRow().redactedTranscriptJson!) as RedactedTurn[];
    expect(turns.find((t) => t.label === "T21")!.segments).toEqual([{ hidden: expect.any(Number) }]);
    expect(releaseRow().redactedTranscriptJson).toContain("Municipal water is fine");
  });

  /** Uploads a corrected transcript made from v1 by `edit`, and re-analyzes it from the hand-labeled claims. */
  async function uploadEdited(edit: (v1: string) => string): Promise<void> {
    const text = edit(readFixtureText("cases", "halvorsen", "transcript-v1.txt"));
    transact((tx) => uploadTranscript(tx, CASE, { text, filename: "corrected.txt", source: "gold" }, user("priya")));
    await drainJobs();
  }

  it("a restricted claim retired by a corrected transcript still has its passages blanked", async () => {
    completeReview();
    // T5 is reworded so the hand-labeled quote no longer matches: C1 is retired (rejected) and F1 reopens.
    await uploadEdited((v1) => v1.replace("orders fell off a cliff. They're down about twenty percent.", "orders fell off. They're down about twenty-five percent."));
    const c1 = loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === G1)!;
    expect(c1.row.status).toBe("rejected");
    dispose(findingOn(G1).id, "restricted_exclude", "jordan");
    attest();
    // A decision on a retired claim's finding goes stale in the release check ("claim removed"), so this
    // case cannot be released yet; build the snapshot exactly as the release does.
    const r = restrictedOnCase(getDb(), CASE);
    expect(r.unplaced).toEqual([]);
    expect(r.passages.map((p) => p.label)).toEqual(expect.arrayContaining(["F1 · T5", "F1 · T11"]));
    const current = turnsOfVersion(getDb(), currentTranscript(getDb(), CASE)!.id);
    const snapshot = redactTurns(current, r.spans).turns;
    const text = JSON.stringify(snapshot);
    expect(text).not.toContain("I still have a login"); // T11 is unchanged: the quote is blanked where it stands
    expect(text).not.toContain("twenty-five percent"); // T5 changed under the quote: the whole turn is blanked
    expect(snapshot.find((t) => t.label === "T5")!.segments).toEqual([{ hidden: expect.any(Number) }]);
  });

  it("a turn inserted before a hidden passage moves the blank with the turn it was on", async () => {
    const kept = liveFindingOn("T21");
    completeReview();
    dispose(kept.id, "restricted_exclude", "marcus");
    const before = turnsOfVersion(getDb(), currentTranscript(getDb(), CASE)!.id);
    const t21 = before.find((t) => t.label === "T21")!.text;
    // A new analyst turn between T20 and T21: the flagged statement is now T22.
    await uploadEdited((v1) => v1.replace("[00:04:56] Expert", "[00:04:55] Analyst (Priya): Sorry, one more on pricing.\n[00:04:56] Expert"));
    const r = restrictedOnCase(getDb(), CASE);
    const current = turnsOfVersion(getDb(), currentTranscript(getDb(), CASE)!.id);
    expect(current.find((t) => t.label === "T22")!.text).toBe(t21);
    expect(r.spans).toContainEqual({ turnLabel: "T22", start: 0, end: t21.length });
    expect(r.spans.some((s) => s.turnLabel === "T21")).toBe(false);
    expect(r.passages.map((p) => p.label)).toContain(`F${kept.seqNo} · T22`);
    expect(r.unplaced).toEqual([]);
    // With no stored lineage (an older database), the turns are aligned directly and land the same way.
    getDb().delete(turnLineage).run();
    expect(restrictedOnCase(getDb(), CASE).spans).toEqual(r.spans);
  });

  it("a correction that splits a hidden turn in two blanks both halves in the released snapshot", async () => {
    const kept = liveFindingOn("T21");
    completeReview();
    dispose(kept.id, "restricted_exclude", "marcus");
    // T21 becomes two turns: lineage pairs the first half with T21 (edited) and reports the second as added.
    await uploadEdited((v1) =>
      v1.replace(
        "Mostly yes. The industry pushed two price increases this year, and distributors accepted them because lead times were so long last year.",
        "Mostly yes. The industry pushed two price increases this year.\n[00:05:15] Expert (R. Castellano): Distributors accepted them because lead times were so long last year.",
      ),
    );
    attest();
    const brief = draftTemplate();
    approve(brief.id);
    const result = release(brief.id);
    expect(result.released ? [] : result.failures).toEqual([]);
    const text = releaseRow().redactedTranscriptJson!;
    expect(text).not.toContain("two price increases"); // the half lineage pairs with T21
    expect(text).not.toContain("lead times were so long"); // the half split off into the added T22
    const turns = JSON.parse(text) as RedactedTurn[];
    expect(turns.find((t) => t.label === "T21")!.segments).toEqual([{ hidden: expect.any(Number) }]);
    expect(turns.find((t) => t.label === "T22")!.segments).toEqual([{ hidden: expect.any(Number) }]);
    expect(JSON.stringify(turns.find((t) => t.label === "T23"))).toContain("That's all my questions"); // the next turn is shown
  });

  it("a split whose short half comes first blanks both halves in the released snapshot", async () => {
    const kept = liveFindingOn("T21");
    completeReview();
    dispose(kept.id, "restricted_exclude", "marcus");
    // Lineage reports the short first half as an added T21 and pairs the rest (now T22) with the old T21.
    await uploadEdited((v1) =>
      v1.replace(
        "Mostly yes. The industry pushed two price increases this year, and distributors accepted them because lead times were so long last year.",
        "Mostly yes.\n[00:05:00] Expert (R. Castellano): The industry pushed two price increases this year, and distributors accepted them because lead times were so long last year.",
      ),
    );
    attest();
    const brief = draftTemplate();
    approve(brief.id);
    const result = release(brief.id);
    expect(result.released ? [] : result.failures).toEqual([]);
    const text = releaseRow().redactedTranscriptJson!;
    expect(text).not.toContain("Mostly yes"); // the added half before the mapped turn
    expect(text).not.toContain("two price increases"); // the half lineage pairs with the old T21
    const turns = JSON.parse(text) as RedactedTurn[];
    expect(turns.find((t) => t.label === "T21")!.segments).toEqual([{ hidden: expect.any(Number) }]);
    expect(turns.find((t) => t.label === "T22")!.segments).toEqual([{ hidden: expect.any(Number) }]);
    expect(text).toContain("And pricing power"); // T20, before the gap, is shown
  });

  it("with no stored lineage, a removed turn between the mapped turn and an added one does not hide the added one", async () => {
    const kept = liveFindingOn("T19");
    completeReview();
    dispose(kept.id, "restricted_exclude", "marcus");
    // T19 is edited, T20 and T21 are replaced by one unrelated expert turn: the diff reads edited, removed, added, removed.
    await uploadEdited((v1) =>
      v1
        .replace("hot-rolled is up about twelve percent", "hot-rolled is up about fifteen percent")
        .replace(
          /\[00:04:50\] Analyst \(Priya\): And pricing power[^\n]*\n\[00:04:56\] Expert \(R\. Castellano\): Mostly yes\.[^\n]*/,
          "[00:04:56] Expert (R. Castellano): Steel aside, Brightwater may cut prices next spring.",
        ),
    );
    const current = turnsOfVersion(getDb(), currentTranscript(getDb(), CASE)!.id);
    expect(current.find((t) => t.label === "T20")!.text).toBe("Steel aside, Brightwater may cut prices next spring.");
    const whole = (label: string) => ({ turnLabel: label, start: 0, end: current.find((t) => t.label === label)!.text.length });
    const stored = restrictedOnCase(getDb(), CASE).spans;
    expect(stored).toEqual(expect.arrayContaining([whole("T19"), whole("T20")]));
    getDb().delete(turnLineage).run();
    expect(restrictedOnCase(getDb(), CASE).spans).toEqual(expect.arrayContaining([whole("T19"), whole("T20")]));
  });

  it("a hidden quote that moved to another turn verbatim is blanked where it now stands", async () => {
    const kept = liveFindingOn("T9");
    completeReview();
    dispose(kept.id, "restricted_exclude", "marcus");
    // T9 is reworded, and its words reappear verbatim (with different spacing) in the analyst's T10.
    await uploadEdited((v1) =>
      v1
        .replace("Municipal water is fine. Oil and gas midstream is the weak spot, and general industrial is flat.", "Municipal water is fine. Oil and gas midstream is weak, and industrial is flat.")
        .replace("Going back to the twenty percent,", "You said Municipal water is   fine. Oil and gas midstream is the weak spot, and general industrial is flat. Going back to the twenty percent,"),
    );
    const r = restrictedOnCase(getDb(), CASE);
    const current = turnsOfVersion(getDb(), currentTranscript(getDb(), CASE)!.id);
    const text = JSON.stringify(redactTurns(current, r.spans).turns);
    expect(text).not.toContain("midstream is the weak spot");
    expect(text).toContain("Going back to the twenty percent"); // only the matched run of T10 is blanked
  });

  it("a hidden passage that cannot be placed on the current transcript refuses the release", () => {
    const lost = transact((tx) => {
      const { finding } = createFinding(tx, { caseId: CASE, claimLogicalKey: null, origin: "live", title: "Flagged during the call", severity: "high", state: "REVIEW_REQUIRED", dedupeKey: "live-test:lost", createdBy: "system" });
      tx.insert(findingPassages).values({ id: newId("fp"), findingId: finding.id, turnId: "tv_gone:T3", startChar: 0, endChar: 40 }).run();
      return finding;
    });
    completeReview();
    dispose(lost.id, "restricted_exclude", "marcus");
    const brief = draftTemplate();
    approve(brief.id);
    const result = release(brief.id);
    expect(result.released).toBe(false);
    expect(codes(result)).toEqual(["HIDDEN_PASSAGE_UNPLACED"]);
    expect(messages(result)).toEqual([`hidden passage F${lost.seqNo} · T3 could not be placed on the current transcript, so it cannot be blanked`]);
    expect(getDb().select().from(releases).all()).toEqual([]);
  });

  it("a restricted figure in a section heading is a leak too", () => {
    completeReview();
    const draft = draftTemplate();
    const sections = briefWorkspace(getDb(), CASE, user("marcus")).brief!.sections;
    sections.push({ heading: "Orders down twenty percent", sentences: [{ text: "Distributors are soft.", claim_ids: ["C2"] }] });
    const edited = transact((tx) => editBrief(tx, draft.id, { sections, expectedVersion: draft.version }, user("marcus")));
    approve(edited.id);
    const result = release(edited.id);
    expect(codes(result).length).toBeGreaterThan(0);
    expect(codes(result).every((c) => c === "SUMMARY_LEAK")).toBe(true);
    expect(messages(result)).toContain("the summary repeats a figure from hidden passage F1 · T5");
  });

  it("restrictedOnCase labels each hidden passage by finding and turn, and keeps eligible names visible", () => {
    completeReview();
    const r = restrictedOnCase(getDb(), CASE);
    expect(r.passages.map((p) => p.label)).toEqual(expect.arrayContaining(["F1 · T5", "F1 · T11", "F2 · T15"]));
    const t5 = r.passages.find((p) => p.label === "F1 · T5")!;
    expect(t5.numbers).toContain(20);
    expect(r.passages.find((p) => p.label === "F2 · T15")!.names).toContain("Cardinal Utilities");
    expect(r.visible.names.has("Halvorsen")).toBe(true); // F3's claim is about Halvorsen too
    expect(r.visible.numbers.has(20)).toBe(false);
  });
});

describe("a summary never cites a claim whose words are hidden (Fix A)", () => {
  // C2 quotes the whole of "Distributors broadly are soft right now. Everyone overbought ..." in T7; C3's
  // context quote is that sentence's first part. The deployed run's C8 and C7 had the same shape in T15.
  const OUTER = "C2";
  const INNER = "C3";
  const releaseRow = () => getDb().select().from(releases).where(eq(releases.caseId, CASE)).orderBy(desc(releases.releasedAt)).get()!;
  const eligibilityOf = (key: string) => eligibilityForCase(getDb(), CASE).claims.find((c) => c.claim.row.logicalKey === key)!.eligibility;

  /** An after-call (policy) finding on one claim, the way analysis raises one. */
  function afterCallFindingOn(claimKey: string): FindingRow {
    return transact((tx) => createFinding(tx, { caseId: CASE, claimLogicalKey: claimKey, origin: "policy", title: "Second look", severity: "high", state: "REVIEW_REQUIRED", dedupeKey: `fixa-test:${claimKey}`, createdBy: "system" }).finding);
  }

  /** Sets a claim's summary behind the workflow's back, leaving its content hash alone so nothing goes stale. */
  function setSummary(claimKey: string, summary: string): void {
    const row = loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === claimKey)!.row;
    getDb().update(claims).set({ fieldsJson: JSON.stringify({ ...JSON.parse(row.fieldsJson), summary }) }).where(eq(claims.id, row.id)).run();
  }

  it("the seed has the shape: the inner claim's quote lies inside the outer claim's, on the same turn", () => {
    const loaded = loadCurrentClaims(getDb(), CASE);
    const outer = loaded.find((c) => c.row.logicalKey === OUTER)!.quotes[0];
    const inner = loaded.find((c) => c.row.logicalKey === INNER)!.quotes.find((q) => q.role === "context")!;
    expect(inner.turnLabel).toBe(outer.turnLabel);
    expect(outer.start <= inner.start && inner.end <= outer.end).toBe(true);
    expect(eligibilityOf(INNER)).toEqual({ eligible: true });
  });

  it("while an after-call finding on the outer claim is not cleared, the inner claim is not eligible", () => {
    const f = afterCallFindingOn(OUTER);
    const detail = `it quotes words in T7 that finding F${f.seqNo} keeps hidden`;
    expect(eligibilityOf(INNER)).toEqual({ eligible: false, reason: "restricted", detail });
    expect(eligibilityOf(OUTER)).toMatchObject({ eligible: false, reason: "finding_open" });
    expect(eligibilityOf("C4")).toEqual({ eligible: true }); // T9: another turn
    completeReview();
    dispose(f.id, "restricted_exclude", "marcus");
    expect(eligibilityOf(INNER)).toEqual({ eligible: false, reason: "restricted", detail });
    // The drafting step never sees the inner claim, and the template cites neither.
    const brief = draftTemplate();
    expect(brief.sentencesJson).not.toContain(`"${INNER}"`);
    expect(brief.sentencesJson).not.toContain(`"${OUTER}"`);
  });

  it("once the outer claim's finding is cleared, the inner claim is eligible again", () => {
    const f = afterCallFindingOn(OUTER);
    completeReview();
    dispose(f.id, "cleared_for_research", "marcus");
    expect(eligibilityOf(INNER)).toEqual({ eligible: true });
    expect(eligibilityOf(OUTER)).toEqual({ eligible: true });
  });

  it("a finding on the inner claim restricts the outer claim, which quotes the hidden words too", () => {
    const f = afterCallFindingOn(INNER);
    expect(eligibilityOf(OUTER)).toEqual({ eligible: false, reason: "restricted", detail: `it quotes words in T7 that finding F${f.seqNo} keeps hidden` });
  });

  it("a live finding's hidden spans are its passages and every quote of a claim it hides", () => {
    // C1 quotes T5 and T11. A live finding on T5 hides all of C1's quotes, so a claim quoting C1's T11 words is restricted too.
    const kept = transact((tx) => {
      const turn = turnsOfVersion(tx, currentTranscript(tx, CASE)!.id).find((t) => t.label === "T5")!;
      const { finding } = createFinding(tx, { caseId: CASE, claimLogicalKey: null, origin: "live", title: "Flagged during the call", severity: "high", state: "REVIEW_REQUIRED", reasonCodes: ["LIVE_ONLY", "TURN:T5"], dedupeKey: "live-test:T5", createdBy: "system" });
      tx.insert(findingPassages).values({ id: newId("fp"), findingId: finding.id, turnId: turn.id, startChar: 0, endChar: 10 }).run();
      return finding;
    });
    const eligibility = eligibilityForCase(getDb(), CASE);
    const live = eligibility.findings.find((f) => f.id === kept.id)!;
    const c1 = loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === G1)!;
    // Its hidden spans are its own passage and every quote of a claim it hides.
    expect(live.hiddenSpans).toEqual(expect.arrayContaining([{ turnLabel: "T5", start: 0, end: 10 }, ...c1.quotes.map((q) => ({ turnLabel: q.turnLabel, start: q.start, end: q.end }))]));
  });

  it("the transcript blanks exactly what it did before", () => {
    afterCallFindingOn(OUTER);
    const spans = restrictedOnCase(getDb(), CASE).spans.filter((s) => s.turnLabel === "T7");
    const outer = loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === OUTER)!.quotes[0];
    expect(spans).toEqual([{ turnLabel: "T7", start: outer.start, end: outer.end }]);
  });

  it("a cited claim whose summary repeats hidden words refuses the release, naming the claim and passage only", () => {
    const brief = reviewAndApprove();
    expect(brief.sentencesJson).toContain('"C4"');
    setSummary("C4", "Municipal water is fine; I still have a login to their pipeline dashboard.");
    const result = release(brief.id);
    expect(result.released).toBe(false);
    expect(codes(result)).toEqual(["CITATION_LEAK"]);
    expect(messages(result)).toEqual(["the summary of cited claim C4 repeats a quote from hidden passage F1 · T11"]);
    expect(getDb().select().from(releases).all()).toEqual([]);
    const blocked = listAudit(getDb(), CASE).at(-1)!;
    expect(blocked.type).toBe("RELEASE_BLOCKED");
    expect(JSON.stringify(blocked)).not.toContain("pipeline dashboard");
  });

  it("a figure in a cited claim's summary is a leak even though that summary is the only eligible place stating it", () => {
    const brief = reviewAndApprove();
    setSummary("C4", "Municipal water is fine, though orders are down about twenty percent.");
    const result = release(brief.id);
    // F1 hides "twenty percent" in both T5 and T11.
    expect(messages(result)).toEqual(["the summary of cited claim C4 repeats a figure from hidden passage F1 · T5", "the summary of cited claim C4 repeats a figure from hidden passage F1 · T11"]);
    expect(codes(result)).toEqual(["CITATION_LEAK", "CITATION_LEAK"]);
  });

  it("the banker's citations drop a quote that overlaps a hidden span", () => {
    const f = afterCallFindingOn(OUTER);
    completeReview();
    dispose(f.id, "restricted_exclude", "marcus");
    const brief = draftTemplate();
    approve(brief.id);
    expect(release(brief.id)).toMatchObject({ released: true });
    // Say the inner claim had been cited anyway: its frozen citation carries both of its quotes.
    const stored = JSON.parse(releaseRow().citationsJson!) as { key: string }[];
    const inner = transact((tx) => citationsFor(tx, CASE, [INNER]))[0];
    expect(inner.quotes).toHaveLength(2);
    getDb().update(releases).set({ citationsJson: JSON.stringify([...stored, inner]) }).where(eq(releases.id, releaseRow().id)).run();
    const shown = releasedBriefs(getDb(), user("priya"))[0].citations.find((c) => c.key === INNER)!;
    expect(shown.quotes.map((q) => q.quote)).toEqual(["Pricing is holding though, and lead times have come in a lot."]);
  });
});

describe("the span rule's edges (Fix A)", () => {
  const eligibilityOf = (key: string, placer?: TurnPlacer) => eligibilityForCase(getDb(), CASE, placer).claims.find((c) => c.claim.row.logicalKey === key)!.eligibility;

  it("a claim quoting words that a live finding hides through another claim's shared turn is restricted", () => {
    // Claim A is C1, quoting T5 and T11. A live finding on T5 hides all of A's quotes, T11 included (`hiddenBy`).
    // Its own finding is cleared, so only the live finding keeps A's T11 words hidden.
    dispose(findingOn(G1).id, "cleared_for_research", "jordan");
    const live = transact((tx) => {
      const t5 = turnsOfVersion(tx, currentTranscript(tx, CASE)!.id).find((t) => t.label === "T5")!;
      const { finding } = createFinding(tx, { caseId: CASE, claimLogicalKey: null, origin: "live", title: "Flagged during the call", severity: "high", state: "REVIEW_REQUIRED", reasonCodes: ["LIVE_ONLY", "TURN:T5"], dedupeKey: "live-test:T5", createdBy: "system" });
      tx.insert(findingPassages).values({ id: newId("fp"), findingId: finding.id, turnId: t5.id, startChar: 0, endChar: 10 }).run();
      return finding;
    });
    // Claim B quotes the same T11 words as A, and has no finding of its own.
    const a = loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === G1)!;
    const aT11 = a.quotes.find((q) => q.turnLabel === "T11")!;
    const template = getDb().select().from(claims).where(eq(claims.id, loadCurrentClaims(getDb(), CASE).find((c) => c.row.logicalKey === "C4")!.row.id)).get()!;
    const bId = newId("clm");
    getDb().insert(claims).values({ ...template, id: bId, logicalKey: "C99" }).run();
    const aQuote = getDb().select().from(claimQuotes).where(eq(claimQuotes.id, aT11.id)).get()!;
    getDb().insert(claimQuotes).values({ ...aQuote, id: newId("clq"), claimId: bId }).run();

    expect(eligibilityOf("C99")).toEqual({ eligible: false, reason: "restricted", detail: `it quotes words in T11 that finding F${live.seqNo} keeps hidden` });
  });

  it("a claim quote that cannot be placed keeps its own turn and span, so it still restricts", () => {
    // C2's quote in T7 holds C3's context quote. A finding on C2 hides C2's words; say C2's quote cannot be placed.
    transact((tx) => createFinding(tx, { caseId: CASE, claimLogicalKey: "C2", origin: "policy", title: "Second look", severity: "high", state: "REVIEW_REQUIRED", dedupeKey: "fixa-test:C2", createdBy: "system" }));
    const loaded = loadCurrentClaims(getDb(), CASE);
    const unplaceable = (quote: { turnId: string; start: number; end: number }): TurnPlacer => {
      const real = turnPlacer(getDb(), CASE);
      return { ...real, place: (turnId, start, end) => (turnId === quote.turnId && start === quote.start && end === quote.end ? null : real.place(turnId, start, end)) };
    };
    const outer = loaded.find((c) => c.row.logicalKey === "C2")!.quotes[0];
    const inner = loaded.find((c) => c.row.logicalKey === "C3")!.quotes.find((q) => q.role === "context")!;
    const restricted = { eligible: false, reason: "restricted", detail: expect.stringMatching(/^it quotes words in T7 that finding F\d+ keeps hidden$/) };
    // The hidden side cannot be placed: C2's own span still hides C3's words.
    expect(eligibilityOf("C3", unplaceable(outer))).toEqual(restricted);
    // The cited side cannot be placed: C3's own span still meets C2's hidden words.
    expect(eligibilityOf("C3", unplaceable(inner))).toEqual(restricted);
  });
});
