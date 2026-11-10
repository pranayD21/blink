/**
 * §14 through the real route handlers: status codes, the error shape, the
 * cookie requirement, and idempotency keys. `next/headers` is the only thing
 * replaced, because there is no request scope outside the Next.js server.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session: { user: string | null; set: [string, string][] } = { user: null, set: [] };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "blink_user" && session.user ? { name, value: session.user } : undefined),
    set: (name: string, value: string) => {
      session.set.push([name, value]);
    },
  }),
}));

import { POST as actAs } from "@/app/api/session/act-as/route";
import { GET as getAnalystBriefs } from "@/app/api/analyst/briefs/route";
import { GET as getAudit } from "@/app/api/audit/route";
import { POST as verifyAudit } from "@/app/api/audit/verify/route";
import { POST as releaseRoute } from "@/app/api/briefs/[id]/release/route";
import { GET as getBriefs } from "@/app/api/cases/[id]/briefs/route";
import { GET as getWorkspace } from "@/app/api/cases/[id]/workspace/route";
import { GET as getCases, POST as postCase } from "@/app/api/cases/route";
import { POST as postEvent } from "@/app/api/findings/[id]/events/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { POST as approvePolicyRoute } from "@/app/api/policies/[versionId]/approve/route";
import { getDb } from "@/server/db/client";
import { decisions, jobs } from "@/server/db/schema";
import { getBrief } from "@/server/services/briefs";
import { CASE, G1, G2, G3, RATIONALE, completeReview, draftTemplate, findingOn, seedAnalyzed } from "../helpers/db";

type Handler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

async function call<P>(handler: Handler<P>, as: string | null, init: { method?: string; path?: string; params?: P; body?: unknown; key?: string } = {}) {
  session.user = as ? `user_${as}` : null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.key) headers["idempotency-key"] = init.key;
  const req = new NextRequest(`http://localhost${init.path ?? "/api/test"}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const res = await handler(req, { params: Promise.resolve((init.params ?? {}) as P) });
  return { status: res.status, replay: res.headers.get("Idempotent-Replay") === "true", json: (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string; details?: unknown } } };
}

beforeEach(async () => {
  session.set = [];
  await seedAnalyzed();
});

describe("session", () => {
  it("every API call needs the blink_user cookie", async () => {
    const res = await call(getCases, null);
    expect(res.status).toBe(401);
    expect(res.json.error).toMatchObject({ code: "NO_SESSION" });
  });

  it("act-as sets the cookie for a seeded user and refuses an unknown one", async () => {
    const ok = await call(actAs, null, { method: "POST", body: { userId: "user_jordan" } });
    expect(ok.status).toBe(200);
    expect(ok.json.user).toMatchObject({ id: "user_jordan", role: "senior_reviewer", roleLabel: "Senior compliance officer" });
    expect(session.set).toEqual([["blink_user", "user_jordan"]]);
    expect((await call(actAs, null, { method: "POST", body: { userId: "user_mallory" } })).status).toBe(401);
  });
});

describe("status codes and the error shape (§14)", () => {
  it("403: an analyst cannot read the workspace, a finding, or an unreleased brief", async () => {
    const workspace = await call(getWorkspace, "priya", { params: { id: CASE } });
    expect(workspace.status).toBe(403);
    expect(workspace.json).toEqual({ error: { code: "FORBIDDEN", message: expect.stringMatching(/compliance reviewers/) } });

    expect((await call(getBriefs, "priya", { params: { id: CASE } })).status).toBe(403);
    expect((await call(getAudit, "priya", { path: `/api/audit?caseId=${CASE}` })).status).toBe(403);
    const dispose = await call(postEvent, "priya", { method: "POST", params: { id: findingOn(G2).id }, body: { type: "DISPOSE", outcome: "no_concern", rationale: RATIONALE, expectedVersion: 1 } });
    expect(dispose.status).toBe(403);
  });

  it("an analyst's case list and released-brief list carry no findings", async () => {
    const list = await call(getCases, "priya");
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.json)).not.toMatch(/REVIEW_REQUIRED|NEEDS_CONTEXT/);
    const briefs = await call(getAnalystBriefs, "priya");
    expect(briefs.json).toEqual({ briefs: [] });
  });

  it("an analyst polling a job sees progress but not its result", async () => {
    const job = getDb().select().from(jobs).where(eq(jobs.type, "analyze_transcript")).get()!;
    const forAnalyst = await call(getJobRoute, "priya", { params: { id: job.id } });
    expect(forAnalyst.json.job).toMatchObject({ status: "succeeded", stage: "Done", result: null });
    const forReviewer = await call(getJobRoute, "marcus", { params: { id: job.id } });
    expect((forReviewer.json.job as { result: unknown }).result).toMatchObject({ findingsOpened: 4 });
  });

  it("400: a body that fails validation names the field", async () => {
    const res = await call(postEvent, "marcus", { method: "POST", params: { id: findingOn(G2).id }, body: { type: "DISPOSE", outcome: "approved", rationale: RATIONALE, expectedVersion: 1 } });
    expect(res.status).toBe(400);
    expect(res.json.error!.code).toBe("VALIDATION");
    expect(res.json.error!.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: "outcome" })]));

    const created = await call(postCase, "priya", { method: "POST", body: { title: "x" } });
    expect(created.status).toBe(400);
  });

  it("404: an unknown finding", async () => {
    const res = await call(postEvent, "marcus", { method: "POST", params: { id: "f_missing" }, body: { type: "ESCALATE", rationale: RATIONALE, expectedVersion: 1 } });
    expect(res.status).toBe(404);
    expect(res.json.error!.code).toBe("NOT_FOUND");
  });

  it("409: a stale expectedVersion", async () => {
    const finding = findingOn(G2);
    const first = await call(postEvent, "marcus", { method: "POST", params: { id: finding.id }, body: { type: "ESCALATE", rationale: RATIONALE, expectedVersion: finding.version } });
    expect(first.status).toBe(200);
    const stale = await call(postEvent, "jordan", { method: "POST", params: { id: finding.id }, body: { type: "DISPOSE", outcome: "restricted_exclude", rationale: RATIONALE, expectedVersion: finding.version } });
    expect(stale.status).toBe(409);
    expect(stale.json.error!.code).toBe("VERSION_CONFLICT");
  });

  it("422: a workflow guard, and 403 for the reviewer on an escalated finding", async () => {
    const waiting = findingOn(G3);
    const guard = await call(postEvent, "marcus", { method: "POST", params: { id: waiting.id }, body: { type: "DISPOSE", outcome: "no_concern", rationale: RATIONALE, expectedVersion: waiting.version } });
    expect(guard.status).toBe(422);
    const escalated = findingOn(G1);
    const role = await call(postEvent, "marcus", { method: "POST", params: { id: escalated.id }, body: { type: "DISPOSE", outcome: "restricted_exclude", rationale: RATIONALE, expectedVersion: escalated.version } });
    expect(role.status).toBe(403);
    const senior = await call(postEvent, "jordan", { method: "POST", params: { id: escalated.id }, body: { type: "DISPOSE", outcome: "restricted_escalate_to_legal", rationale: RATIONALE, expectedVersion: escalated.version } });
    expect(senior.status).toBe(200);
    expect(senior.json).toMatchObject({ label: "F1", state: "DISPOSITIONED" });
  });

  it("409: a failed release check lists every failure", async () => {
    completeReview();
    const brief = draftTemplate();
    const res = await call(releaseRoute, "marcus", { method: "POST", params: { id: brief.id }, body: { audience: "analyst", expectedVersion: brief.version } });
    expect(res.status).toBe(409);
    expect(res.json.error!.code).toBe("RELEASE_CHECK_FAILED");
    const failures = (res.json.error!.details as { failures: { code: string; message: string }[] }).failures;
    expect(failures.map((f) => f.code)).toEqual(expect.arrayContaining(["BRIEF_NOT_APPROVED", "APPROVAL_MISSING", "CASE_NOT_APPROVED"]));
    expect(getBrief(getDb(), brief.id).status).toBe("draft");
  });

  it("the policy approve route is closed to everyone but the owner", async () => {
    const res = await call(approvePolicyRoute, "marcus", { method: "POST", params: { versionId: "pv_missing" }, body: { bundleHash: "0".repeat(64) } });
    expect([403, 404]).toContain(res.status);
  });

  it("anyone signed in can verify the audit chain", async () => {
    const res = await call(verifyAudit, "priya", { method: "POST" });
    expect(res.json).toMatchObject({ ok: true });
  });
});

describe("Idempotency-Key", () => {
  it("a repeated request returns the first response and applies once", async () => {
    const finding = findingOn(G2);
    const request = { method: "POST", params: { id: finding.id }, path: `/api/findings/${finding.id}/events`, body: { type: "DISPOSE", outcome: "restricted_exclude", rationale: RATIONALE, expectedVersion: finding.version }, key: "click-1" };
    const first = await call(postEvent, "marcus", request);
    const second = await call(postEvent, "marcus", request);
    expect(first.status).toBe(200);
    expect(first.replay).toBe(false);
    expect(second.status).toBe(200);
    expect(second.replay).toBe(true);
    expect(second.json).toEqual(first.json);
    expect(getDb().select().from(decisions).where(eq(decisions.findingId, finding.id)).all()).toHaveLength(1);

    // Without the key the same body is a new request, and the version check refuses it.
    const third = await call(postEvent, "marcus", { ...request, key: undefined });
    expect(third.status).toBe(409);
  });

  it("a key is scoped to the user who sent it", async () => {
    const finding = findingOn(G2);
    const request = { method: "POST", params: { id: finding.id }, path: `/api/findings/${finding.id}/events`, body: { type: "ESCALATE", rationale: RATIONALE, expectedVersion: finding.version }, key: "same-key" };
    expect((await call(postEvent, "marcus", request)).status).toBe(200);
    const other = await call(postEvent, "jordan", request);
    expect(other.replay).toBe(false);
    expect(other.status).toBe(409);
  });
});
