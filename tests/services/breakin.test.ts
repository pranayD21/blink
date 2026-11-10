/**
 * Break-in tests (live guidance, section 5): act as a banker and try every route the app exposes,
 * through the real handlers in password mode. A caller with no session is refused; another banker
 * is refused on everything tied to Priya's case; and nothing the owning banker can read, error or
 * not, carries a passage compliance keeps hidden. `next/headers` is the only thing replaced.
 *
 * The database: a live call on the Halvorsen case fed and ended, the after-call read done from the
 * hand-labeled claims, one flag only the live call raised, the case reviewed (F1 and F2 kept hidden,
 * F3 cleared), and a template brief drafted, approved and released to the banker.
 */
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const session: { token: string | null } = { token: null };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "blink_session" && session.token ? { name, value: session.token } : undefined),
    set: () => {},
  }),
  headers: async () => new Headers(),
}));

import { POST as login } from "@/app/api/session/login/route";
import { turnHash } from "@/core/deps/hash";
import { type GroundingTurn, groundExtraction } from "@/core/extraction/ground";
import { type LlmExtraction, LlmExtractionSchema } from "@/core/extraction/schema";
import type { ClaimRecord } from "@/core/types";
import { EVIDENCE_FIELDS } from "@/core/types";
import { findingCleared } from "@/core/workflow/brief";
import { hashPassword } from "@/server/auth/password";
import { fromJson, getDb, resetDbForTests, transact } from "@/server/db/client";
import { callClaims, callTurns, calls, claims, documents, findingPassages, findings, tasks, turns, users } from "@/server/db/schema";
import { drainJobs } from "@/server/jobs/runner";
import type { LiveReader } from "@/server/live/reader";
import { eligibilityForCase, getBrief } from "@/server/services/briefs";
import { endCall, ingestTurn, startCall } from "@/server/services/live";
import { activePolicyVersion, currentTranscript } from "@/server/services/loaders";
import { restrictedOnCase } from "@/server/services/redaction";
import { halvorsenCaseInput, seedDatabase } from "@/server/services/seed";
import { CASE, G1, approve, completeReview, dispose, draftTemplate, findingOn, release, user } from "../helpers/db";
import { readJson } from "../helpers/fixtures";
import { goldReader, halvorsenLiveTurns } from "../helpers/live";

const ROOT = resolve(__dirname, "../..");
const API_DIR = "src/app/api";

/** Every `route.ts` under `src/app/api`, as a path from the repository root. */
function routeFiles(): string[] {
  return (readdirSync(join(ROOT, API_DIR), { recursive: true }) as string[])
    .map((f) => f.split("\\").join("/"))
    .filter((f) => f === "route.ts" || f.endsWith("/route.ts"))
    .map((f) => `${API_DIR}/${f}`)
    .sort();
}

type Who = "priya" | "sam" | "marcus";
type Method = "GET" | "POST" | "PATCH";

interface Row {
  file: string;
  method: Method;
  /** The route acts on Priya's case (or something of it): another banker must get 403 or 404. */
  caseScoped: boolean;
  /** What a caller with no session gets. 401 when not given. */
  noSession?: number;
  params?: () => Record<string, string>;
  query?: () => string;
  body?: () => unknown;
}

// ── The state the routes are tried against ──────────────────────────────────

const PASSWORDS: Record<Who, string> = { priya: "breakin-priya-password", marcus: "breakin-marcus-password", sam: "breakin-sam-password" };
const EMAILS: Record<Who, string> = { priya: "priya@blink.demo", marcus: "marcus@blink.demo", sam: "sam@blink.demo" };
const tokens: Partial<Record<Who, string>> = {};

const ids = { call: "", release: "", brief: "", job: "", claim: "", finding: "", task: "", document: "", policy: "", transcript: "" };

const CALL_START = Date.parse("2026-11-10T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const halvorsen = halvorsenLiveTurns();
const turnInput = (seq: number) => {
  const t = halvorsen[seq - 1];
  return { ...t, speechEndedAt: iso(CALL_START + t.speechEndMs), transcribedAt: iso(CALL_START + t.speechEndMs + 200) };
};

/**
 * The gold reader, plus one flag the after-call read does not raise: the dashboard claim said in T7
 * as claim L1. Ending the call turns it into a live finding with a passage, so `finding_passages`
 * holds hidden text too.
 */
function readerWithLiveOnlyFlag(): LiveReader {
  const gold = goldReader();
  const extraction = LlmExtractionSchema.parse(readJson<{ extraction: unknown }>("cases", "halvorsen", "gold.json").extraction);
  const c1 = extraction.claims.find((c) => c.logical_key === "C1")!;
  const claim: LlmExtraction["claims"][number] = { ...c1, logical_key: "L1", quotes: [{ turn_id: "T7", quote: "Distributors broadly are soft right now.", role: "primary", supports_fields: [...EVIDENCE_FIELDS] }] };
  const atT7: GroundingTurn[] = halvorsen.slice(0, 7).map((t) => ({ label: `T${t.seq}`, idx: t.seq, speaker: t.speaker, text: t.text, textHash: turnHash(t.text) }));
  const extra = groundExtraction({ claims: [claim], suggested_concerns: [], missing_context_questions: [], call_summary: "" }, atT7).claims;
  return async (input) => {
    const result = await gold(input);
    if (input.newTurnLabel !== "T7" || result.status !== "read") return result;
    return { ...result, claims: [...result.claims, ...extra] };
  };
}

async function signIn(who: Who): Promise<string> {
  const res = await login(new NextRequest("http://localhost/api/session/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: EMAILS[who], password: PASSWORDS[who] }) }));
  const token = /blink_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  if (res.status !== 200 || !token) throw new Error(`signing in as ${who} failed with ${res.status}`);
  return token;
}

async function buildState(): Promise<void> {
  resetDbForTests();
  process.env.BLINK_SEED_PASSWORDS = JSON.stringify({ user_priya: PASSWORDS.priya, user_marcus: PASSWORDS.marcus });
  await seedDatabase({ manualPolicy: true, enqueueDocFacts: false, goldDocFacts: true });
  delete process.env.BLINK_SEED_PASSWORDS;
  // A second banker, who owns nothing.
  getDb().insert(users).values({ id: "user_sam", name: "Sam Ortiz", role: "analyst", email: EMAILS.sam, passwordHash: hashPassword(PASSWORDS.sam) }).run();

  const call = transact((tx) => startCall(tx, { caseId: CASE }, user("priya")));
  const reader = readerWithLiveOnlyFlag();
  for (let seq = 1; seq <= halvorsen.length; seq++) await ingestTurn(call.id, turnInput(seq), user("priya"), { reader });
  transact((tx) => endCall(tx, call.id, user("priya"), { source: "gold" }));
  await drainJobs();

  const live = getDb().select().from(findings).where(and(eq(findings.caseId, CASE), eq(findings.origin, "live"))).all();
  if (live.length !== 1) throw new Error(`expected one live-only finding, found ${live.length}`);
  dispose(live[0].id, "restricted_exclude", "marcus");
  completeReview();
  const brief = draftTemplate();
  approve(brief.id);
  const released = release(brief.id);
  if (!released.released) throw new Error(`the release failed: ${released.failures.map((f) => f.code).join(", ")}`);

  const db = getDb();
  const callRow = db.select().from(calls).where(eq(calls.id, call.id)).get()!;
  Object.assign(ids, {
    call: call.id,
    release: released.releaseId,
    brief: brief.id,
    job: callRow.analysisJobId!,
    claim: db.select().from(claims).where(and(eq(claims.caseId, CASE), eq(claims.logicalKey, G1))).get()!.id,
    finding: findingOn(G1).id,
    task: db.select().from(tasks).where(eq(tasks.caseId, CASE)).get()!.id,
    document: db.select().from(documents).get()!.id,
    policy: activePolicyVersion(db)!.id,
    transcript: currentTranscript(db, CASE)!.id,
  });
  for (const who of ["priya", "marcus", "sam"] as const) tokens[who] = await signIn(who);
}

// ── What is hidden ──────────────────────────────────────────────────────────

/**
 * Every restricted quote, every `finding_passages` text, and the text of every live turn a flagged
 * call claim quotes. A flagged claim compliance has since cleared (F3, the margin statement) is
 * shown on release by design, so its turn is not hidden text.
 */
function hiddenTexts(): string[] {
  const db = getDb();
  const restricted = restrictedOnCase(db, CASE).passages.map((p) => p.text);

  const passages = db
    .select()
    .from(findingPassages)
    .all()
    .map((p) => db.select().from(turns).where(eq(turns.id, p.turnId)).get()?.text.slice(p.startChar, p.endChar) ?? "");

  const caseFindings = eligibilityForCase(db, CASE).findings;
  const cleared = (key: string) => {
    const on = caseFindings.filter((f) => f.claimLogicalKey === key);
    return on.length > 0 && on.every(findingCleared);
  };
  const live: string[] = [];
  for (const claim of db.select().from(callClaims).where(eq(callClaims.callId, ids.call)).all()) {
    if (claim.flagged === "none" || cleared(claim.logicalKey)) continue;
    for (const q of fromJson<ClaimRecord>(claim.recordJson, { quotes: [] } as unknown as ClaimRecord).quotes) {
      const seq = Number(q.turnLabel.slice(1));
      const turn = db.select().from(callTurns).where(and(eq(callTurns.callId, ids.call), eq(callTurns.seq, seq))).get();
      if (turn) live.push(turn.text);
    }
  }
  return [...new Set([...restricted, ...passages, ...live].map((t) => t.trim()).filter((t) => t.length > 0))];
}

/** A hidden text as it would appear inside a JSON string, escapes and all. */
const asJson = (text: string) => JSON.stringify(text).slice(1, -1);

// ── The routes ──────────────────────────────────────────────────────────────

const LATER = "2026-11-10T15:30:00.000Z";

const TABLE: Row[] = [
  { file: "src/app/api/analyst/briefs/route.ts", method: "GET", caseScoped: false },
  { file: "src/app/api/analyst/releases/[id]/route.ts", method: "GET", caseScoped: true, params: () => ({ id: ids.release }) },
  { file: "src/app/api/audit/route.ts", method: "GET", caseScoped: false },
  { file: "src/app/api/audit/route.ts", method: "GET", caseScoped: true, query: () => `caseId=${CASE}` },
  { file: "src/app/api/audit/verify/route.ts", method: "POST", caseScoped: false },
  {
    file: "src/app/api/briefs/[id]/approve/route.ts",
    method: "POST",
    caseScoped: true,
    params: () => ({ id: ids.brief }),
    body: () => {
      const b = getBrief(getDb(), ids.brief);
      return { briefHash: b.contentHash, audience: "analyst", expectedVersion: b.version };
    },
  },
  { file: "src/app/api/briefs/[id]/release/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.brief }), body: () => ({ audience: "analyst", expectedVersion: getBrief(getDb(), ids.brief).version }) },
  {
    file: "src/app/api/briefs/[id]/route.ts",
    method: "PATCH",
    caseScoped: true,
    params: () => ({ id: ids.brief }),
    body: () => ({ sections: [{ heading: "Halvorsen", sentences: [{ text: "Demand is soft.", claim_ids: ["C4"] }] }], expectedVersion: getBrief(getDb(), ids.brief).version }),
  },
  { file: "src/app/api/calls/[id]/acks/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.call }), body: () => ({ seq: 1, responseReceivedAt: LATER, shownAt: LATER }) },
  { file: "src/app/api/calls/[id]/end/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.call }), body: () => ({}) },
  {
    file: "src/app/api/calls/[id]/outages/route.ts",
    method: "POST",
    caseScoped: true,
    params: () => ({ id: ids.call }),
    body: () => ({ stage: "hearing", startedAt: LATER, endedAt: null, cause: "microphone unplugged", shownToBanker: true }),
  },
  { file: "src/app/api/calls/[id]/stt-token/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.call }), body: () => ({}) },
  { file: "src/app/api/calls/[id]/turns/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.call }), body: () => turnInput(1) },
  { file: "src/app/api/calls/route.ts", method: "POST", caseScoped: true, body: () => ({ caseId: CASE }) },
  { file: "src/app/api/cases/[id]/analyze/route.ts", method: "POST", caseScoped: true, params: () => ({ id: CASE }), body: () => ({}) },
  { file: "src/app/api/cases/[id]/attest/route.ts", method: "POST", caseScoped: true, params: () => ({ id: CASE }), body: () => ({ transcriptVersionId: ids.transcript }) },
  { file: "src/app/api/cases/[id]/baseline/route.ts", method: "POST", caseScoped: true, params: () => ({ id: CASE }), body: () => ({ outcome: "no_concern", notes: "Nothing in this call needs action." }) },
  { file: "src/app/api/cases/[id]/briefs/route.ts", method: "GET", caseScoped: true, params: () => ({ id: CASE }) },
  { file: "src/app/api/cases/[id]/briefs/route.ts", method: "POST", caseScoped: true, params: () => ({ id: CASE }), body: () => ({ mode: "template" }) },
  { file: "src/app/api/cases/[id]/session/route.ts", method: "POST", caseScoped: true, params: () => ({ id: CASE }), body: () => ({}) },
  { file: "src/app/api/cases/[id]/transcripts/route.ts", method: "POST", caseScoped: true, params: () => ({ id: CASE }), body: () => ({ text: "Expert: Orders were flat in the quarter.", filename: "breakin.txt" }) },
  { file: "src/app/api/cases/[id]/workspace/route.ts", method: "GET", caseScoped: true, params: () => ({ id: CASE }) },
  { file: "src/app/api/cases/route.ts", method: "GET", caseScoped: false },
  { file: "src/app/api/cases/route.ts", method: "POST", caseScoped: false, body: () => ({ ...halvorsenCaseInput(), title: "Break-in case" }) },
  { file: "src/app/api/claims/[id]/public-match/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.claim }), body: () => ({ verdict: "clear", expectedVersion: 1 }) },
  { file: "src/app/api/claims/[id]/route.ts", method: "PATCH", caseScoped: true, params: () => ({ id: ids.claim }), body: () => ({ verified: {}, expectedVersion: 1 }) },
  { file: "src/app/api/dev/script-turns/route.ts", method: "GET", caseScoped: false, noSession: 404 },
  { file: "src/app/api/documents/[id]/verify/route.ts", method: "POST", caseScoped: false, params: () => ({ id: ids.document }), body: () => ({ factId: "F1", verified: true, expectedVersion: 1 }) },
  { file: "src/app/api/documents/route.ts", method: "GET", caseScoped: false },
  { file: "src/app/api/findings/[id]/events/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.finding }), body: () => ({ type: "PROMOTE", rationale: "Looks restricted to me.", expectedVersion: 1 }) },
  { file: "src/app/api/findings/[id]/tasks/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.finding }), body: () => ({ question: "Where did this figure come from?" }) },
  {
    file: "src/app/api/findings/route.ts",
    method: "POST",
    caseScoped: true,
    body: () => ({ caseId: CASE, title: "Raised by hand", severity: "high", explanation: "The expert named a customer.", turnLabel: "T15" }),
  },
  { file: "src/app/api/jobs/[id]/route.ts", method: "GET", caseScoped: true, params: () => ({ id: ids.job }) },
  { file: "src/app/api/metrics/route.ts", method: "GET", caseScoped: false },
  { file: "src/app/api/policies/[versionId]/approve/route.ts", method: "POST", caseScoped: false, params: () => ({ versionId: ids.policy }), body: () => ({ bundleHash: "0".repeat(64) }) },
  { file: "src/app/api/policies/[versionId]/compile/route.ts", method: "POST", caseScoped: false, params: () => ({ versionId: ids.policy }) },
  { file: "src/app/api/policies/[versionId]/route.ts", method: "GET", caseScoped: false, params: () => ({ versionId: ids.policy }) },
  { file: "src/app/api/policies/[versionId]/use-manual/route.ts", method: "POST", caseScoped: false, params: () => ({ versionId: ids.policy }) },
  { file: "src/app/api/policies/route.ts", method: "GET", caseScoped: false },
  { file: "src/app/api/policies/route.ts", method: "POST", caseScoped: false, body: () => ({ title: "Break-in policy", text: "P1. Never share inside information with anyone." }) },
  // Only in switcher mode: with password sign-in it is not there at all.
  { file: "src/app/api/session/act-as/route.ts", method: "POST", caseScoped: false, noSession: 404, body: () => ({ userId: "user_marcus" }) },
  { file: "src/app/api/session/login/route.ts", method: "POST", caseScoped: false, noSession: 400, body: () => ({}) },
  // Signing out answers 200 whether or not there was a session.
  { file: "src/app/api/session/logout/route.ts", method: "POST", caseScoped: false, noSession: 200, body: () => ({}) },
  { file: "src/app/api/tasks/[id]/answer/route.ts", method: "POST", caseScoped: true, params: () => ({ id: ids.task }), body: () => ({ answer: "From the public filing.", expectedVersion: 1 }) },
  { file: "src/app/api/transcripts/preview/route.ts", method: "POST", caseScoped: false, body: () => ({ text: "Expert: Orders were flat in the quarter." }) },
];

type RouteModule = Partial<Record<Method, (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>>>;
const loadRoute = (file: string): Promise<RouteModule> => import(/* @vite-ignore */ join(ROOT, file));

/** Calls the row's handler as `who` (null: no session) and returns the status and the parsed body. */
async function hit(r: Row, who: Who | null, override: { body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
  const handler = (await loadRoute(r.file))[r.method];
  if (!handler) throw new Error(`${r.file} exports no ${r.method}`);
  const params = r.params?.() ?? {};
  const path = r.file
    .replace(/^src\/app/, "")
    .replace(/\/route\.ts$/, "")
    .replace(/\[(\w+)\]/g, (_, k: string) => encodeURIComponent(params[k]));
  const query = r.query?.();
  const body = "body" in override ? override.body : r.body?.();
  session.token = who ? tokens[who]! : null;
  const req = new NextRequest(`http://localhost${path}${query ? `?${query}` : ""}`, {
    method: r.method,
    headers: { "content-type": "application/json" },
    body: r.method === "GET" || body === undefined ? undefined : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve(params) });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON: compared as the raw text.
  }
  return { status: res.status, json };
}

const GETS = TABLE.filter((r) => r.method === "GET");

/** Fails naming the route and the hidden text's first words when `json` contains any of `hidden`. */
function expectNoHiddenText(json: unknown, where: string, hidden: readonly string[]): void {
  const body = typeof json === "string" ? json : JSON.stringify(json);
  for (const q of hidden) {
    expect(body, `${where} repeats "${q.slice(0, 30)}…"`).not.toContain(q);
    expect(body, `${where} repeats "${q.slice(0, 30)}…"`).not.toContain(asJson(q));
  }
}

beforeAll(async () => {
  vi.stubEnv("BLINK_AUTH_MODE", "password");
  vi.stubEnv("BLINK_ALLOW_SCRIPTED_CALLS", "");
  await buildState();
}, 60_000);

afterAll(() => {
  session.token = null;
  vi.unstubAllEnvs();
});

describe("break-in: every route, as a banker (live guidance, section 5)", () => {
  it("every route file is in the table", () => expect(routeFiles().filter((f) => !TABLE.some((r) => r.file === f))).toEqual([]));

  it("every method a route file exports is in the table, and every row names one that exists", async () => {
    const missing: string[] = [];
    for (const file of routeFiles()) {
      const mod = await loadRoute(file);
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
        if (method in mod && !TABLE.some((r) => r.file === file && r.method === method)) missing.push(`${method} ${file}`);
      }
    }
    expect(missing).toEqual([]);
    for (const r of TABLE) expect(typeof (await loadRoute(r.file))[r.method], `${r.method} ${r.file}`).toBe("function");
  });

  it("the database holds hidden text of every kind, and a reviewer's view shows it", async () => {
    const db = getDb();
    expect(restrictedOnCase(db, CASE).passages.length).toBeGreaterThanOrEqual(4);
    expect(db.select().from(findingPassages).all()).toHaveLength(1);
    expect(db.select().from(callClaims).where(eq(callClaims.callId, ids.call)).all().filter((c) => c.flagged !== "none").length).toBeGreaterThanOrEqual(3);
    // The check can fire: compliance's own workspace carries the hidden passages.
    const workspace = JSON.stringify((await hit(TABLE.find((r) => r.file.endsWith("cases/[id]/workspace/route.ts"))!, "marcus")).json);
    expect(hiddenTexts().filter((q) => workspace.includes(q) || workspace.includes(asJson(q))).length).toBeGreaterThan(0);
  });

  it.each(TABLE)("$method $file answers a caller with no session as the table says", async (r) => expect((await hit(r, null)).status).toBe(r.noSession ?? 401));

  it.each(TABLE.filter((r) => r.caseScoped))("$method $file refuses another banker", async (r) => expect([403, 404]).toContain((await hit(r, "sam")).status));

  it("another banker's lists name nothing of Priya's case", async () => {
    const cases = (await hit(TABLE.find((r) => r.file === "src/app/api/cases/route.ts" && r.method === "GET")!, "sam")).json as { cases: unknown[] };
    expect(cases.cases).toEqual([]);
    const briefs = (await hit(TABLE.find((r) => r.file === "src/app/api/analyst/briefs/route.ts")!, "sam")).json as { briefs: unknown[] };
    expect(briefs.briefs).toEqual([]);
  });

  it("the owning banker reads the release, blanked", async () => {
    const res = await hit(TABLE.find((r) => r.file.includes("analyst/releases"))!, "priya");
    expect(res.status).toBe(200);
    expect((res.json as { hiddenPassages: number }).hiddenPassages).toBeGreaterThanOrEqual(3);
  });

  it("no response to the owning banker contains hidden text, anywhere", async () => {
    for (const r of TABLE.filter((r) => r.method === "GET")) {
      const body = JSON.stringify((await hit(r, "priya")).json);
      for (const q of hiddenTexts()) expect(body, r.file).not.toContain(q);
    }
  });

  // Mutates the database, so it runs last.
  it("an error never repeats hidden text", async () => {
    const hidden = hiddenTexts();
    const row = (file: string, method: Method = "POST") => TABLE.find((r) => r.file === `src/app/api/${file}` && r.method === method)!;

    // The release failure: the released brief cannot be released again.
    const again = await hit(row("briefs/[id]/release/route.ts"), "marcus");
    expect(again.status).toBe(409);
    expect((again.json as { error: { code: string } }).error.code).toBe("RELEASE_CHECK_FAILED");

    // The leak failure: an edit that repeats F1's restricted figure is blocked by the release check.
    const workspace = (await hit(row("cases/[id]/briefs/route.ts", "GET"), "marcus")).json as { brief: { sections: { heading: string; sentences: { text: string; claim_ids: string[] }[] }[]; version: number } };
    const sections = workspace.brief.sections;
    sections[0].sentences.push({ text: "Distributors are soft, with orders down about twenty percent.", claim_ids: ["C4"] });
    const edited = await hit(row("briefs/[id]/route.ts", "PATCH"), "marcus", { body: { sections, expectedVersion: workspace.brief.version } });
    expect(edited.status).toBe(200);
    const leaking = edited.json as { briefId: string; contentHash: string; version: number };
    const leakRelease = { ...row("briefs/[id]/release/route.ts"), params: () => ({ id: leaking.briefId }) };
    const leakApprove = { ...row("briefs/[id]/approve/route.ts"), params: () => ({ id: leaking.briefId }) };
    await hit(leakApprove, "marcus", { body: { briefHash: leaking.contentHash, audience: "analyst", expectedVersion: leaking.version } });
    const blocked = await hit(leakRelease, "marcus", { body: { audience: "analyst", expectedVersion: getBrief(getDb(), leaking.briefId).version } });
    expect(blocked.status).toBe(409);
    const failures = (blocked.json as { error: { details: { failures: { code: string }[] } } }).error.details.failures;
    expect(failures.map((f) => f.code)).toContain("SUMMARY_LEAK");
    expectNoHiddenText(blocked.json, "the leak failure", hidden);

    // Priya tries every route that is not her own sign-in or sign-out, then reads every route again.
    for (const r of TABLE.filter((r) => !r.file.includes("/session/"))) expectNoHiddenText((await hit(r, "priya")).json, `${r.method} ${r.file} as priya`, hidden);
    const after = [...new Set([...hidden, ...hiddenTexts()])];
    for (const r of GETS) expectNoHiddenText((await hit(r, "priya")).json, `GET ${r.file} as priya, afterwards`, after);
  });
});
