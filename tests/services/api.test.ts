/**
 * §14 through the real route handlers: status codes, the error shape, the
 * cookie requirement, and idempotency keys. `next/headers` is the only thing
 * replaced, because there is no request scope outside the Next.js server.
 */
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session: { user: string | null; token: string | null; path: string | null; set: [string, string][] } = { user: null, token: null, path: null, set: [] };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "blink_user" && session.user) return { name, value: session.user };
      if (name === "blink_session" && session.token) return { name, value: session.token };
      return undefined;
    },
    set: (name: string, value: string) => {
      session.set.push([name, value]);
    },
  }),
  headers: async () => new Headers(session.path ? { "x-blink-path": session.path } : {}),
}));

import { POST as actAs } from "@/app/api/session/act-as/route";
import { POST as login } from "@/app/api/session/login/route";
import { POST as register } from "@/app/api/session/register/route";
import { POST as logout } from "@/app/api/session/logout/route";
import { GET as getAnalystBriefs } from "@/app/api/analyst/briefs/route";
import { GET as getAnalystRelease } from "@/app/api/analyst/releases/[id]/route";
import { GET as getAudit } from "@/app/api/audit/route";
import { POST as verifyAudit } from "@/app/api/audit/verify/route";
import { POST as releaseRoute } from "@/app/api/briefs/[id]/release/route";
import { GET as getBriefs } from "@/app/api/cases/[id]/briefs/route";
import { POST as postTranscript } from "@/app/api/cases/[id]/transcripts/route";
import { GET as getWorkspace } from "@/app/api/cases/[id]/workspace/route";
import { GET as getCases, POST as postCase } from "@/app/api/cases/route";
import { POST as postEvent } from "@/app/api/findings/[id]/events/route";
import { GET as getJobRoute } from "@/app/api/jobs/[id]/route";
import { GET as getMetrics } from "@/app/api/metrics/route";
import { POST as approvePolicyRoute } from "@/app/api/policies/[versionId]/approve/route";
import { hashPassword } from "@/server/auth/password";
import { optionalPageActor, pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { authSessions, cases, decisions, jobs, llmCalls, loginAttempts, releases, users } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { getBrief } from "@/server/services/briefs";
import { analystCaseView } from "@/server/services/cases";
import { loadActor } from "@/server/auth/actor";
import { CASE, G1, G2, G3, RATIONALE, appError, approve, completeReview, draftTemplate, findingOn, release, seedAnalyzed } from "../helpers/db";

type Handler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

async function call<P>(handler: Handler<P>, as: string | null, init: { method?: string; path?: string; params?: P; body?: unknown; key?: string; origin?: string } = {}) {
  session.user = as ? `user_${as}` : null;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (init.key) headers["idempotency-key"] = init.key;
  if (init.origin) headers.origin = init.origin;
  const req = new NextRequest(`http://localhost${init.path ?? "/api/test"}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const res = await handler(req, { params: Promise.resolve((init.params ?? {}) as P) });
  return { status: res.status, replay: res.headers.get("Idempotent-Replay") === "true", json: (await res.json()) as Record<string, unknown> & { error?: { code: string; message: string; details?: unknown } } };
}

beforeEach(async () => {
  session.set = [];
  session.token = null;
  session.path = null;
  await seedAnalyzed();
  // A second banker, who created no case.
  getDb().insert(users).values({ id: "user_sam", name: "Sam Ortiz", role: "analyst" }).run();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session", () => {
  it("every API call needs the blink_user cookie", async () => {
    const res = await call(getCases, null);
    expect(res.status).toBe(401);
    expect(res.json.error).toMatchObject({ code: "NO_SESSION" });
  });

  it("in switcher mode a page falls back to the default demo user and never redirects", async () => {
    session.user = null;
    expect((await pageActor()).id).toBe("user_marcus");
    expect((await optionalPageActor())?.id).toBe("user_marcus");
    session.user = "user_priya";
    expect((await pageActor()).id).toBe("user_priya");
  });

  it("act-as sets the cookie for a seeded user and refuses an unknown one", async () => {
    const ok = await call(actAs, null, { method: "POST", body: { userId: "user_jordan" } });
    expect(ok.status).toBe(200);
    expect(ok.json.user).toMatchObject({ id: "user_jordan", role: "senior_reviewer", roleLabel: "Senior compliance officer" });
    expect(session.set).toEqual([["blink_user", "user_jordan"]]);
    expect((await call(actAs, null, { method: "POST", body: { userId: "user_mallory" } })).status).toBe(401);
  });
});

/** A sign-in through the real route. The response's own Set-Cookie header is read, not the mock. */
async function signIn(email: string, password: string, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  const res = await login(new NextRequest("http://localhost/api/session/login", { method: "POST", headers, body: JSON.stringify({ email, password }) }));
  const setCookie = res.headers.get("set-cookie") ?? "";
  const token = /blink_session=([^;]*)/.exec(setCookie)?.[1] ?? null;
  return { status: res.status, setCookie, token, json: (await res.json()) as { user?: { id: string; role: string }; error?: { code: string; message: string } } };
}

describe("signing in (password mode)", () => {
  const PASSWORD = "priya-test-password";
  beforeEach(() => {
    vi.stubEnv("BLINK_AUTH_MODE", "password");
    getDb().update(users).set({ passwordHash: hashPassword(PASSWORD) }).where(eq(users.id, "user_priya")).run();
  });

  it("signing in sets an HttpOnly session and the session reaches the API", async () => {
    const res = await signIn("priya@blink.demo", PASSWORD);
    expect(res.status).toBe(200);
    expect(res.json.user).toMatchObject({ id: "user_priya", role: "analyst" });
    expect(res.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.setCookie).toMatch(/HttpOnly/i);
    expect(res.setCookie).toMatch(/SameSite=Lax/i);
    expect(res.setCookie).toMatch(/Path=\//);
    expect(res.setCookie).toMatch(/Max-Age=43200/);
    expect(res.setCookie).not.toMatch(/Secure/i); // only in production
    expect(JSON.stringify(res.json)).not.toContain(res.token!);

    expect((await call(getCases, null)).status).toBe(401);
    session.token = res.token;
    expect((await call(getCases, null)).status).toBe(200);
  });

  it("the cookie is Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await signIn("priya@blink.demo", PASSWORD)).setCookie).toMatch(/Secure/i);
  });

  it("the email is matched without regard to case or surrounding spaces", async () => {
    expect((await signIn("  Priya@Blink.Demo ", PASSWORD)).status).toBe(200);
  });

  it("a wrong password and an unknown email give the same answer", async () => {
    const wrong = await signIn("priya@blink.demo", "not-the-password");
    const unknown = await signIn("nobody@blink.demo", PASSWORD);
    const noPassword = await signIn("marcus@blink.demo", "anything");
    for (const res of [wrong, unknown, noPassword]) {
      expect(res.status).toBe(401);
      expect(res.json.error!.code).toBe("BAD_CREDENTIALS");
      expect(res.token).toBeNull();
    }
    expect(unknown.json.error!.message).toBe(wrong.json.error!.message);
    expect(noPassword.json.error!.message).toBe(wrong.json.error!.message);
  });

  it("five failures lock the email out, even for the right password", async () => {
    for (let i = 0; i < 5; i++) expect((await signIn("priya@blink.demo", "wrong")).status).toBe(401);
    const locked = await signIn("priya@blink.demo", PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.json.error!.code).toBe("TOO_MANY_ATTEMPTS");
    expect(locked.token).toBeNull();
  });

  it("an over-long email is refused before anything is recorded", async () => {
    const res = await signIn(`${"a".repeat(250)}@blink.demo`, PASSWORD);
    expect(res.status).toBe(400);
    expect(getDb().select().from(loginAttempts).all()).toHaveLength(0);
  });

  it("the role switcher is gone in password mode", async () => {
    expect((await call(actAs, null, { method: "POST", body: { userId: "user_marcus" } })).status).toBe(404);
    expect(session.set).toEqual([]);
  });

  it("a banker's session cannot be turned into a reviewer's by sending blink_user", async () => {
    session.token = (await signIn("priya@blink.demo", PASSWORD)).token;
    const workspace = await call(getWorkspace, "marcus", { params: { id: CASE } });
    expect(workspace.status).toBe(403);
    // And blink_user alone is no session at all.
    session.token = null;
    expect((await call(getWorkspace, "marcus", { params: { id: CASE } })).status).toBe(401);
  });

  it("signing out ends the session and clears the cookie", async () => {
    const { token } = await signIn("priya@blink.demo", PASSWORD);
    const formPost = await logout(new NextRequest("http://localhost/api/session/logout", { method: "POST", headers: { cookie: `blink_session=${token}`, "content-type": "application/x-www-form-urlencoded" } }));
    expect(formPost.status).toBe(415);
    session.token = token;
    expect((await call(getCases, null)).status).toBe(200);

    const res = await logout(new NextRequest("http://localhost/api/session/logout", { method: "POST", headers: { cookie: `blink_session=${token}`, "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/blink_session=;.*Max-Age=0/i);
    session.token = token;
    expect((await call(getCases, null)).status).toBe(401);
    expect(getDb().select().from(authSessions).all()).toHaveLength(0);
  });

  it("a page with no valid session sends the visitor to sign in and back", async () => {
    session.path = "/desktop";
    session.user = "user_marcus";
    const digest = await pageActor().then(
      () => "no redirect",
      (e: { digest?: string }) => e.digest ?? String(e),
    );
    expect(digest).toMatch(/^NEXT_REDIRECT;[a-z]+;\/login\?next=%2Fdesktop;/);
    expect(await optionalPageActor()).toBeNull();

    session.token = (await signIn("priya@blink.demo", PASSWORD)).token;
    expect((await pageActor()).id).toBe("user_priya");
    expect((await optionalPageActor())?.id).toBe("user_priya");
  });

  it("signing in again replaces the browser's earlier session", async () => {
    const first = await signIn("priya@blink.demo", PASSWORD);
    const second = await signIn("priya@blink.demo", PASSWORD, `blink_session=${first.token}`);
    expect(second.status).toBe(200);
    session.token = first.token;
    expect((await call(getCases, null)).status).toBe(401);
    session.token = second.token;
    expect((await call(getCases, null)).status).toBe(200);
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

  it("the released transcript: the banker who owns the case reads it blanked; another banker and the unreleased case get 404", async () => {
    completeReview();
    const brief = draftTemplate();
    approve(brief.id);
    expect((await call(getAnalystBriefs, "priya")).json).toEqual({ briefs: [] });
    release(brief.id);
    const id = getDb().select().from(releases).get()!.id;

    const own = await call(getAnalystRelease, "priya", { params: { id } });
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ release: { id, standing: "current" }, hiddenPassages: expect.any(Number) });
    expect(JSON.stringify(own.json)).not.toMatch(/Cardinal|I still have a login/);

    const other = await call(getAnalystRelease, "sam", { params: { id } });
    expect(other.status).toBe(404);
    expect(other.json.error!.code).toBe("NOT_FOUND");
    expect((await call(getAnalystBriefs, "sam")).json).toEqual({ briefs: [] });
    expect((await call(getAnalystRelease, "priya", { params: { id: "rel_missing" } })).status).toBe(404);
    expect((await call(getAnalystRelease, null, { params: { id } })).status).toBe(401);
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

const ids = (res: { json: Record<string, unknown> }) => (res.json.cases as { id: string }[]).map((c) => c.id);

describe("every request is checked for the case it touches", () => {
  it("a banker's case list holds only their own cases", async () => {
    expect(ids(await call(getCases, "sam"))).not.toContain(CASE);
    expect(ids(await call(getCases, "priya"))).toContain(CASE);
    expect(ids(await call(getCases, "dana"))).toEqual([]);
  });

  it("a banker cannot open, upload to, or poll another banker's case", async () => {
    const sam = loadActor(getDb(), "user_sam");
    expect(appError(() => analystCaseView(getDb(), CASE, sam))).toMatchObject({ status: 404, code: "NOT_FOUND" });

    const upload = await call(postTranscript, "sam", { method: "POST", params: { id: CASE }, body: { text: "Expert: Orders were flat in the quarter.", source: "gold" } });
    expect(upload.status).toBe(404);
    expect(upload.json.error).toEqual({ code: "NOT_FOUND", message: "case not found" });

    const job = getDb().select().from(jobs).where(eq(jobs.type, "analyze_transcript")).get()!;
    const poll = await call(getJobRoute, "sam", { params: { id: job.id } });
    expect(poll.status).toBe(404);
    // The same answer as a job that does not exist, so the id says nothing.
    expect(poll.json).toEqual((await call(getJobRoute, "sam", { params: { id: "job_missing" } })).json);
    expect((await call(getJobRoute, "priya", { params: { id: job.id } })).status).toBe(200);
    expect((await call(getJobRoute, "dana", { params: { id: job.id } })).status).toBe(403);
  });

  it("a job with no case keeps its role rule", async () => {
    const compile = enqueueJob(getDb(), "compile_policy", { policyVersionId: "pv_x" });
    const forOwner = await call(getJobRoute, "dana", { params: { id: compile.id } });
    expect(forOwner.status).toBe(200);
    expect((forOwner.json.job as { payload: unknown }).payload).toEqual({ policyVersionId: "pv_x" });
    const forBanker = await call(getJobRoute, "sam", { params: { id: compile.id } });
    expect(forBanker.status).toBe(200);
    expect((forBanker.json.job as { payload: unknown }).payload).toEqual({});
  });

  it("a reviewer still sees every case", async () => {
    expect(ids(await call(getCases, "marcus"))).toContain(CASE);
    expect(ids(await call(getCases, "jordan"))).toContain(CASE);
  });

  it("a request from another site is refused", async () => {
    const body = { text: "Expert: Orders were flat in the quarter.", source: "gold" };
    const evil = await call(postTranscript, "priya", { method: "POST", params: { id: CASE }, body, origin: "https://evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.json.error!.code).toBe("BAD_ORIGIN");
    // A look-alike host with the app's name in it is another site too.
    expect((await call(postTranscript, "priya", { method: "POST", params: { id: CASE }, body, origin: "http://localhost.evil.example" })).status).toBe(403);
    expect((await call(postTranscript, "priya", { method: "POST", params: { id: CASE }, body, origin: "null" })).status).toBe(403);

    const own = await call(postTranscript, "priya", { method: "POST", params: { id: CASE }, body, origin: "http://localhost" });
    expect(own.status).not.toBe(403);
    // A GET is never refused for its origin: it changes nothing.
    expect((await call(getCases, "priya", { origin: "https://evil.example" })).status).toBe(200);
  });

  it("behind a proxy the forwarded host counts as the app's own", async () => {
    session.user = "user_marcus";
    const req = (origin: string) =>
      new NextRequest("http://10.0.0.5:3000/api/audit/verify", { method: "POST", headers: { "content-type": "application/json", origin, "x-forwarded-host": "blink.example.com" } });
    expect((await verifyAudit(req("https://blink.example.com"), { params: Promise.resolve({}) })).status).toBe(200);
    expect((await verifyAudit(req("https://evil.example"), { params: Promise.resolve({}) })).status).toBe(403);
  });

  it("only the first forwarded host counts, and a forwarded scheme must match", async () => {
    session.user = "user_marcus";
    const post = (origin: string, extra: Record<string, string>) =>
      verifyAudit(new NextRequest("http://10.0.0.5:3000/api/audit/verify", { method: "POST", headers: { "content-type": "application/json", origin, ...extra } }), { params: Promise.resolve({}) });
    // A proxy chain appends: the client-facing host is the first entry, never a later one.
    expect((await post("https://blink.example.com", { "x-forwarded-host": "blink.example.com, evil.example" })).status).toBe(200);
    expect((await post("https://evil.example", { "x-forwarded-host": "blink.example.com, evil.example" })).status).toBe(403);
    // The scheme the client used must be the origin's scheme.
    expect((await post("https://blink.example.com", { "x-forwarded-host": "blink.example.com", "x-forwarded-proto": "https" })).status).toBe(200);
    expect((await post("http://blink.example.com", { "x-forwarded-host": "blink.example.com", "x-forwarded-proto": "https" })).status).toBe(403);
  });

  it("the Host header counts as the app's own when the request URL names another host", async () => {
    session.user = "user_marcus";
    const post = (origin: string) =>
      verifyAudit(new NextRequest("http://127.0.0.1:3000/api/audit/verify", { method: "POST", headers: { "content-type": "application/json", origin, host: "blink.example.com" } }), { params: Promise.resolve({}) });
    expect((await post("https://blink.example.com")).status).toBe(200);
    expect((await post("https://evil.example")).status).toBe(403);
  });

  it("metrics: a banker is refused, the policy owner sees only per-stage costs, a reviewer everything", async () => {
    const banker = await call(getMetrics, "priya");
    expect(banker.status).toBe(403);
    expect(banker.json.error!.code).toBe("FORBIDDEN");

    const title = getDb().select().from(cases).where(eq(cases.id, CASE)).get()!.title;
    // One model call tied to the case, so the reviewer's per-case cost row names it.
    getDb()
      .insert(llmCalls)
      .values({ id: "llm_metrics_test", stage: "extract", requestHash: "h", model: "claude-opus-5-5", promptVersion: "v1", requestJson: "{}", responseJson: "{}", inputTokens: 1000, outputTokens: 100, latencyMs: 1200, replayed: false, refJson: JSON.stringify({ caseId: CASE }), createdAt: "2026-11-10T00:00:00.000Z" })
      .run();
    const reviewer = await call(getMetrics, "marcus");
    expect(reviewer.status).toBe(200);
    expect(reviewer.json).toMatchObject({ scope: "full", reviewTime: expect.any(Object), corrections: [expect.objectContaining({ caseId: CASE, title })], llm: { perCase: [expect.objectContaining({ caseId: CASE, title })] } });
    expect((await call(getMetrics, "jordan")).json.scope).toBe("full");

    const owner = await call(getMetrics, "dana");
    expect(owner.status).toBe(200);
    expect(Object.keys(owner.json).sort()).toEqual(["llm", "scope"]);
    expect(Object.keys(owner.json.llm as object).sort()).toEqual(["anyReplayed", "stages", "totalCostUsd", "unpricedCalls"]);
    expect((owner.json.llm as { stages: unknown[] }).stages).toEqual((reviewer.json.llm as { stages: unknown[] }).stages);
    expect((owner.json.llm as { stages: { stage: string }[] }).stages.map((st) => st.stage)).toContain("extract");
    const body = JSON.stringify(owner.json);
    expect(body).not.toContain(title);
    expect(body).not.toContain(CASE);
  });

  it("sign-in and sign-out from another site are refused", async () => {
    const headers = { "content-type": "application/json", origin: "https://evil.example" };
    const signInRes = await login(new NextRequest("http://localhost/api/session/login", { method: "POST", headers, body: JSON.stringify({ email: "priya@blink.demo", password: "x" }) }));
    expect(signInRes.status).toBe(403);
    expect(((await signInRes.json()) as { error: { code: string } }).error.code).toBe("BAD_ORIGIN");
    expect(getDb().select().from(loginAttempts).all()).toHaveLength(0);
    const signOutRes = await logout(new NextRequest("http://localhost/api/session/logout", { method: "POST", headers, body: "{}" }));
    expect(signOutRes.status).toBe(403);
    const sameSite = await logout(new NextRequest("http://localhost/api/session/logout", { method: "POST", headers: { ...headers, origin: "http://localhost" }, body: "{}" }));
    expect(sameSite.status).toBe(200);
  });
});

describe("creating an account", () => {
  async function openAccount(body: unknown) {
    const res = await register(new NextRequest("http://localhost/api/session/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const setCookie = res.headers.get("set-cookie") ?? "";
    return { status: res.status, setCookie, json: (await res.json()) as { user?: { name: string; role: string }; error?: { code: string } } };
  }

  it("opens a banker account, signs it in, and refuses a second one on the same email", async () => {
    const created = await openAccount({ name: "Amina Shah", email: "Amina@Example.com", password: "a-long-password" });
    expect(created.status).toBe(200);
    expect(created.json.user).toMatchObject({ name: "Amina Shah", role: "analyst" });
    expect(created.setCookie).toMatch(/blink_session=/);
    expect(JSON.stringify(created.json)).not.toContain("a-long-password");

    const again = await openAccount({ name: "Someone Else", email: "amina@example.com", password: "another-password" });
    expect(again.status).toBe(409);
    expect(again.json.error?.code).toBe("EMAIL_TAKEN");

    const signedIn = await signIn("amina@example.com", "a-long-password");
    expect(signedIn.status).toBe(200);
    expect(signedIn.json.user?.role).toBe("analyst");
  });

  it("refuses a short password", async () => {
    expect((await openAccount({ name: "Amina Shah", email: "short@example.com", password: "short" })).status).toBe(400);
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
