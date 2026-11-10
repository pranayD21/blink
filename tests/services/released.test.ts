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
import { loadCurrentClaims } from "@/server/services/loaders";
import { releasedTranscript } from "@/server/services/released";
import { CASE, G1, G2, appError, approve, completeReview, draftTemplate, release, reviewAndApprove, seedAnalyzed, uploadV2, user } from "../helpers/db";

beforeEach(seedAnalyzed);

const releaseRow = () => getDb().select().from(releases).where(eq(releases.caseId, CASE)).orderBy(desc(releases.releasedAt)).get()!;

/** The quotes of the claims whose findings completeReview() restricted (C1 and C7). */
const restrictedQuotes = (): string[] =>
  loadCurrentClaims(getDb(), CASE)
    .filter((c) => c.row.logicalKey === G1 || c.row.logicalKey === G2)
    .flatMap((c) => c.quotes.map((q) => q.quote));

/** A second banker who did not create the case. */
function otherBanker(): Actor {
  getDb().insert(users).values({ id: "user_sam", name: "Sam Ortiz", role: "analyst" }).run();
  return { id: "user_sam", name: "Sam Ortiz", role: "analyst" };
}

describe("the banker reads the released transcript", () => {
  it("the banker's transcript holds no restricted text, in any field", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    const quotes = restrictedQuotes();
    expect(quotes.length).toBeGreaterThanOrEqual(2);
    const body = JSON.stringify(releasedTranscript(getDb(), releaseRow().id, user("priya")));
    for (const quote of quotes) expect(body).not.toContain(JSON.stringify(quote).slice(1, -1));
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
    for (const quote of restrictedQuotes()) expect(body).not.toContain(JSON.stringify(quote).slice(1, -1));
    expect(body).toContain("Distributors broadly are soft");
  });

  it("compliance reads every release, and still only the blanked snapshot", () => {
    const brief = reviewAndApprove();
    release(brief.id);
    expect(releasedBriefs(getDb(), user("marcus"))).toHaveLength(1);
    expect(releasedBriefs(getDb(), user("jordan"))).toHaveLength(1);
    const body = JSON.stringify(releasedTranscript(getDb(), releaseRow().id, user("marcus")));
    for (const quote of restrictedQuotes()) expect(body).not.toContain(JSON.stringify(quote).slice(1, -1));
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
});
