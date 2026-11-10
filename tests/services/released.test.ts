/**
 * What a banker may read after a call (live guidance, section 5): the summary and the transcript with the
 * hidden passages blanked, and only for a release the banker is allowed to see.
 */
import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { releases, turns, users } from "@/server/db/schema";
import { releasedBriefs } from "@/server/services/briefs";
import { currentTranscript, loadCurrentClaims, turnsOfVersion } from "@/server/services/loaders";
import { restrictedOnCase } from "@/server/services/redaction";
import { releasedTranscript } from "@/server/services/released";
import { CASE, G1, G2, STEEL, appError, approve, completeReview, draftTemplate, release, reviewAndApprove, seedAnalyzed, uploadV2, user } from "../helpers/db";

beforeEach(seedAnalyzed);

const releaseRow = () => getDb().select().from(releases).where(eq(releases.caseId, CASE)).orderBy(desc(releases.releasedAt)).get()!;

/** The quotes of the claims whose findings completeReview() restricted (C1 and C7). */
const restrictedQuotes = (): string[] =>
  loadCurrentClaims(getDb(), CASE)
    .filter((c) => c.row.logicalKey === G1 || c.row.logicalKey === G2)
    .flatMap((c) => c.quotes.map((q) => q.quote));

/** The text of every span compliance hid on the current transcript, as `restrictedOnCase` reports them. */
const hiddenTexts = (): string[] => {
  const turns = turnsOfVersion(getDb(), currentTranscript(getDb(), CASE)!.id);
  return restrictedOnCase(getDb(), CASE).spans.map((s) => turns.find((t) => t.label === s.turnLabel)!.text.slice(s.start, s.end));
};
const escaped = (text: string) => JSON.stringify(text).slice(1, -1);
const expectNoHidden = (body: string) => {
  const hidden = hiddenTexts();
  expect(hidden.length).toBeGreaterThanOrEqual(2);
  for (const text of [...hidden, ...restrictedQuotes()]) expect(body).not.toContain(escaped(text));
};

/** A second banker who did not create the case. */
function otherBanker(): Actor {
  getDb().insert(users).values({ id: "user_sam", name: "Sam Ortiz", role: "analyst" }).run();
  return { id: "user_sam", name: "Sam Ortiz", role: "analyst" };
}

describe("the banker reads the released transcript", () => {
  it("the banker's transcript holds no restricted text, in any field", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    expect(restrictedQuotes().length).toBeGreaterThanOrEqual(2);
    const body = JSON.stringify(releasedTranscript(getDb(), releaseRow().id, user("priya")));
    expectNoHidden(body);
    expect(body).toContain("Distributors broadly are soft");
  });

  it("it reports the case, the standing and how many passages are hidden", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const row = releaseRow();
    const view = releasedTranscript(getDb(), row.id, user("priya"));
    expect(view.release).toMatchObject({ id: row.id, releasedAt: row.releasedAt, standing: "current" });
    expect(view.release.caseTitle).toBeTruthy();
    expect(view.hiddenPassages).toBe(row.hiddenPassages);
    expect(view.hiddenPassages).toBeGreaterThanOrEqual(2);
    expect(view.turns.some((t) => t.segments.some((s) => "hidden" in s))).toBe(true);
  });

  it("nothing is readable before release", () => {
    expect(releasedBriefs(getDb(), user("priya"))).toEqual([]);
    completeReview();
    expect(releasedBriefs(getDb(), user("priya"))).toEqual([]);
  });

  it("another banker cannot read it, or see it in the list", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const sam = otherBanker();
    expect(releasedBriefs(getDb(), sam)).toEqual([]);
    expect(appError(() => releasedTranscript(getDb(), releaseRow().id, sam)).status).toBe(404);
    expect(releasedBriefs(getDb(), user("priya"))).toHaveLength(1);
  });

  it("an unknown release is a 404", () => {
    expect(appError(() => releasedTranscript(getDb(), "rel_nope", user("priya"))).status).toBe(404);
  });

  it("a release to the investment team is visible to every banker", () => {
    completeReview();
    const brief = draftTemplate();
    approve(brief.id, "investment_team");
    release(brief.id, "investment_team");
    const sam = otherBanker();
    expect(releasedBriefs(getDb(), sam)).toHaveLength(1);
    const body = JSON.stringify(releasedTranscript(getDb(), releaseRow().id, sam));
    expectNoHidden(body);
    expect(body).toContain("Distributors broadly are soft");
  });

  it("compliance reads every release, and still only the blanked snapshot", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    expect(releasedBriefs(getDb(), user("marcus"))).toHaveLength(1);
    expect(releasedBriefs(getDb(), user("jordan"))).toHaveLength(1);
    const body = JSON.stringify(releasedTranscript(getDb(), releaseRow().id, user("marcus")));
    expectNoHidden(body);
  });

  it("the turns come only from the snapshot: a changed turns table does not show", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const id = releaseRow().id;
    const before = JSON.stringify(releasedTranscript(getDb(), id, user("priya")));
    getDb().update(turns).set({ text: "tampered" }).run();
    expect(JSON.stringify(releasedTranscript(getDb(), id, user("priya")))).toBe(before);
  });

  it("after a corrected transcript arrives the snapshot stays, marked under re-review", async () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const id = releaseRow().id;
    const before = releasedTranscript(getDb(), id, user("priya")).turns;
    await uploadV2();
    const after = releasedTranscript(getDb(), id, user("priya"));
    expect(after.release.standing).toBe("under_re_review");
    expect(after.turns).toEqual(before);
  });

  it("the banker's citations are frozen at release: a corrected transcript changes none of them", async () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const before = releasedBriefs(getDb(), user("priya"))[0].citations;
    const steel = before.find((c) => c.key === STEEL)!;
    expect(steel.quotes.map((q) => q.quote).join(" ")).toMatch(/twelve/);
    expect(before.find((c) => c.key === "C8")!.quotes.length).toBeGreaterThan(0);

    await uploadV2();
    const after = releasedBriefs(getDb(), user("priya"));
    expect(after[0].standing).toBe("under_re_review");
    expect(after[0].citations).toEqual(before);
    const body = JSON.stringify(after);
    expect(body).not.toMatch(/twenty-one/);
    expectNoHidden(body.replaceAll("twenty-one", ""));
  });

  it("a stored quote that touches a hidden run is not shown, even if the stored citations were tampered with", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const row = releaseRow();
    const hiddenQuote = restrictedQuotes()[0];
    const stored = JSON.parse(row.citationsJson!) as { key: string; summary: string; quotes: { turnLabel: string; quote: string; role: string }[] }[];
    stored[0].quotes.push({ turnLabel: "T5", quote: hiddenQuote, role: "support" }, { turnLabel: "T15", quote: "Cardinal", role: "support" });
    getDb().update(releases).set({ citationsJson: JSON.stringify(stored) }).where(eq(releases.id, row.id)).run();
    const body = JSON.stringify(releasedBriefs(getDb(), user("priya")));
    expect(body).not.toContain(escaped(hiddenQuote));
    expect(body).not.toContain("Cardinal");
  });

  it("a release with no stored snapshot says the transcript is not available and shows no citations", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const row = releaseRow();
    getDb().update(releases).set({ redactedTranscriptJson: null, hiddenPassages: null, citationsJson: null }).where(eq(releases.id, row.id)).run();
    expect(releasedTranscript(getDb(), row.id, user("priya"))).toMatchObject({ available: false, turns: [], hiddenPassages: 0 });
    expect(releasedBriefs(getDb(), user("priya"))[0].citations).toEqual([]);
  });

  it("a banker is not told a release was superseded by one they cannot open", () => {
    completeReview();
    const v1 = draftTemplate();
    approve(v1.id, "investment_team");
    release(v1.id, "investment_team");
    const v2 = draftTemplate();
    approve(v2.id, "analyst");
    release(v2.id, "analyst");

    const sam = otherBanker();
    expect(releasedBriefs(getDb(), sam).map((b) => [b.versionNo, b.standing, b.staleReason])).toEqual([[1, "current", null]]);
    expect(releasedBriefs(getDb(), user("priya")).map((b) => [b.versionNo, b.standing])).toEqual([
      [2, "current"],
      [1, "superseded"],
    ]);
  });
});
