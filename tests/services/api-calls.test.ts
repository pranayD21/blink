/**
 * The routes the banker's app calls during a live call, through the real handlers: who may start
 * and post, what a bad turn does, and the speech-to-text token. `next/headers` is the only thing
 * replaced. No reader is injected, so a turn is read in replay mode and comes back as "listening".
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session: { user: string | null } = { user: null };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "blink_user" && session.user ? { name, value: session.user } : undefined),
    set: () => {},
  }),
}));

import { POST as postAck } from "@/app/api/calls/[id]/acks/route";
import { POST as postEnd } from "@/app/api/calls/[id]/end/route";
import { POST as postOutage } from "@/app/api/calls/[id]/outages/route";
import { POST as postToken } from "@/app/api/calls/[id]/stt-token/route";
import { POST as postTurn } from "@/app/api/calls/[id]/turns/route";
import { POST as postCall } from "@/app/api/calls/route";
import { GET as getScriptTurns } from "@/app/api/dev/script-turns/route";
import { getDb, resetDbForTests } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { loadActor } from "@/server/auth/actor";
import { callableCases } from "@/server/services/live";
import { halvorsenLiveTurns, seedDatabase } from "@/server/services/seed";
import { CASE } from "../helpers/db";

type Handler<P> = (req: NextRequest, ctx: { params: Promise<P> }) => Promise<Response>;

async function call<P>(handler: Handler<P>, as: string | null, init: { method?: string; params?: P; body?: unknown } = {}) {
  session.user = as ? `user_${as}` : null;
  const req = new NextRequest("http://localhost/api/test", {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await handler(req, { params: Promise.resolve((init.params ?? {}) as P) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

const turn = { seq: 1, speaker: "expert", text: "Distributors are soft right now.", speechStartMs: 0, speechEndMs: 3000, speechEndedAt: "2026-11-10T10:00:03.000Z", transcribedAt: "2026-11-10T10:00:03.400Z" };

async function start(as = "priya") {
  const res = await call(postCall, as, { body: { caseId: CASE } });
  return { res, id: res.json.call?.id as string };
}

beforeEach(async () => {
  resetDbForTests();
  await seedDatabase({ manualPolicy: true, enqueueDocFacts: false, goldDocFacts: true });
  getDb().insert(users).values({ id: "user_sam", name: "Sam Other", role: "analyst" }).run();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("call routes", () => {
  it("a banker starts a call on their own case and posts a turn", async () => {
    const { res, id } = await start();
    expect(res.status).toBe(201);
    expect(res.json.call).toEqual({ id: expect.any(String), status: "live", startedAt: expect.any(String) });

    const posted = await call(postTurn, "priya", { params: { id }, body: turn });
    expect(posted.status).toBe(200);
    expect(posted.json).toMatchObject({ seq: 1, pill: { level: "listening", text: "Listening" } });

    expect((await call(postAck, "priya", { params: { id }, body: { seq: 1, responseReceivedAt: turn.transcribedAt, shownAt: turn.transcribedAt } })).json).toEqual({ ok: true });
    const outage = await call(postOutage, "priya", { params: { id }, body: { stage: "reading", startedAt: turn.speechEndedAt, endedAt: null, cause: "timeout", shownToBanker: false } });
    expect(outage.status).toBe(201);
    expect(outage.json.outageId).toEqual(expect.any(String));
  });

  it("a reviewer cannot start a call; another banker cannot post to this one", async () => {
    expect((await call(postCall, "jordan", { body: { caseId: CASE } })).status).toBe(403);
    const { id } = await start();
    expect((await call(postTurn, "sam", { params: { id }, body: turn })).status).toBe(404);
    expect((await call(postEnd, "sam", { params: { id }, body: {} })).status).toBe(404);
  });

  it("an empty turn is a 400", async () => {
    const { id } = await start();
    expect((await call(postTurn, "priya", { params: { id }, body: { ...turn, text: "  " } })).status).toBe(400);
  });

  it("ending a call replies with the after-call result, and a second end is a 409", async () => {
    const { id } = await start();
    await call(postTurn, "priya", { params: { id }, body: turn });
    const ended = await call(postEnd, "priya", { params: { id }, body: {} });
    expect(ended.status).toBe(200);
    expect(ended.json).toMatchObject({ hiddenCount: expect.any(Number), pillText: expect.any(String) });
    expect((await call(postEnd, "priya", { params: { id }, body: {} })).json.error.code).toBe("CALL_NOT_LIVE");
  });
});

describe("stt token route", () => {
  it("returns Deepgram's token and never the key", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-secret-key-123");
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ access_token: "tok", expires_in: 30 }));
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await start();
    const res = await call(postToken, "priya", { params: { id }, body: {} });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ accessToken: "tok", expiresIn: 30 });
    expect(JSON.stringify(res.json)).not.toContain("dg-secret-key-123");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.deepgram.com/v1/auth/grant");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Token dg-secret-key-123");
    expect(init?.body).toBe(JSON.stringify({ ttl_seconds: 30 }));
  });

  it("a token request after the call ended is a 409", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-secret-key-123");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await start();
    await call(postEnd, "priya", { params: { id }, body: {} });
    const res = await call(postToken, "priya", { params: { id }, body: {} });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("CALL_NOT_LIVE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("another banker gets a 404", async () => {
    const { id } = await start();
    expect((await call(postToken, "sam", { params: { id }, body: {} })).status).toBe(404);
  });

  it("an upstream failure or a missing key is a 502 that leaks neither the body nor the key", async () => {
    const { id } = await start();
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-secret-key-123");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream says dg-secret-key-123 is bad", { status: 403 })));
    const bad = await call(postToken, "priya", { params: { id }, body: {} });
    expect(bad.status).toBe(502);
    expect(bad.json.error.code).toBe("STT_UNAVAILABLE");
    expect(JSON.stringify(bad.json)).not.toMatch(/dg-secret-key-123|upstream says/);

    vi.stubEnv("DEEPGRAM_API_KEY", "");
    const missing = await call(postToken, "priya", { params: { id }, body: {} });
    expect(missing.status).toBe(502);
    expect(missing.json.error.code).toBe("STT_UNAVAILABLE");
  });
});

describe("scripted call route", () => {
  it("is not there unless scripted calls are allowed, whoever asks", async () => {
    vi.stubEnv("BLINK_ALLOW_SCRIPTED_CALLS", "");
    for (const who of ["priya", "marcus", null]) {
      const res = await call(getScriptTurns, who, { method: "GET" });
      expect(res.status, String(who)).toBe(404);
      expect(res.json.error.code).toBe("NOT_FOUND");
    }
  });

  it("where allowed, gives a banker the scripted turns: speaker and words only", async () => {
    vi.stubEnv("BLINK_ALLOW_SCRIPTED_CALLS", "1");
    const res = await call(getScriptTurns, "priya", { method: "GET" });
    expect(res.status).toBe(200);
    expect(res.json.turns).toEqual(halvorsenLiveTurns().map((t) => ({ speaker: t.speaker, text: t.text })));
    expect((await call(getScriptTurns, "marcus", { method: "GET" })).status).toBe(403);
    expect((await call(getScriptTurns, null, { method: "GET" })).status).toBe(401);
  });
});

describe("the control page's cases", () => {
  const casesOf = (id: string) => callableCases(getDb(), loadActor(getDb(), `user_${id}`)).map((c) => c.id);

  it("a banker sees their own cases at intake, nobody else sees them, and an ended call takes the case off", async () => {
    expect(casesOf("priya")).toEqual([CASE]);
    expect(casesOf("sam")).toEqual([]);
    expect(casesOf("marcus")).toEqual([]);
    const { id } = await start();
    expect(casesOf("priya")).toEqual([CASE]); // still at intake while the call is live
    await call(postTurn, "priya", { params: { id }, body: turn });
    expect((await call(postEnd, "priya", { params: { id }, body: {} })).status).toBe(200);
    expect(casesOf("priya")).toEqual([]);
  });
});
