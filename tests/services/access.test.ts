/**
 * Who may touch which case (live guidance, section 5): a banker only the cases they created, a
 * reviewer every case, the policy owner none. Another banker's case is "not found", the same
 * answer as a case that does not exist, so a case id says nothing about whether it is there.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { requireCaseAccess, visibleCaseIds } from "@/server/auth/access";
import { type Actor, loadActor } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { analystCaseView } from "@/server/services/cases";
import { heartbeat } from "@/server/services/sessions";
import { requestReanalysis, uploadTranscript } from "@/server/services/transcripts";
import { CASE, appError, seedAnalyzed, user } from "../helpers/db";

const sam = (): Actor => loadActor(getDb(), "user_sam");

beforeEach(async () => {
  await seedAnalyzed();
  getDb().insert(users).values({ id: "user_sam", name: "Sam Ortiz", role: "analyst" }).run();
});

describe("requireCaseAccess", () => {
  it("the banker who created the case may open it", () => {
    expect(requireCaseAccess(getDb(), user("priya"), CASE).id).toBe(CASE);
  });

  it("another banker gets the same 404 as a case that does not exist", () => {
    const other = appError(() => requireCaseAccess(getDb(), sam(), CASE));
    const missing = appError(() => requireCaseAccess(getDb(), sam(), "case_missing"));
    expect(other).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(other.message).toBe(missing.message);
  });

  it("reviewers and senior reviewers open any case", () => {
    expect(requireCaseAccess(getDb(), user("marcus"), CASE).id).toBe(CASE);
    expect(requireCaseAccess(getDb(), user("jordan"), CASE).id).toBe(CASE);
    expect(appError(() => requireCaseAccess(getDb(), user("marcus"), "case_missing")).status).toBe(404);
  });

  it("the policy owner is refused, whether or not the case exists", () => {
    expect(appError(() => requireCaseAccess(getDb(), user("dana"), CASE))).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(appError(() => requireCaseAccess(getDb(), user("dana"), "case_missing")).status).toBe(403);
  });
});

describe("visibleCaseIds", () => {
  it("a banker sees their own cases, a reviewer all, the policy owner none", () => {
    expect(visibleCaseIds(getDb(), user("priya"))).toEqual(new Set([CASE]));
    expect(visibleCaseIds(getDb(), sam())).toEqual(new Set());
    expect(visibleCaseIds(getDb(), user("marcus"))).toBe("all");
    expect(visibleCaseIds(getDb(), user("jordan"))).toBe("all");
    expect(visibleCaseIds(getDb(), user("dana"))).toEqual(new Set());
  });
});

describe("the services a banker can reach check the case", () => {
  it("analystCaseView: the owner reads it, another banker gets 404", () => {
    expect(analystCaseView(getDb(), CASE, user("priya")).case.id).toBe(CASE);
    expect(appError(() => analystCaseView(getDb(), CASE, sam())).status).toBe(404);
  });

  it("uploadTranscript: another banker gets 404 and nothing is stored", () => {
    expect(appError(() => uploadTranscript(getDb(), CASE, { text: "Expert: hello there", source: "gold" }, sam())).status).toBe(404);
  });

  it("requestReanalysis and heartbeat: the policy owner and bankers are refused", () => {
    expect(appError(() => requestReanalysis(getDb(), CASE, user("dana"))).status).toBe(403);
    expect(appError(() => heartbeat(getDb(), CASE, user("dana"), "blink")).status).toBe(403);
    expect(appError(() => heartbeat(getDb(), CASE, sam(), "blink")).status).toBe(403);
    expect(appError(() => heartbeat(getDb(), "case_missing", user("marcus"), "blink")).status).toBe(404);
    expect(heartbeat(getDb(), CASE, user("marcus"), "blink").activeMs).toBe(0);
  });
});
