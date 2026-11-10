/**
 * The banker-side call session, driven in node with a stubbed fetch, fake timers and a scripted
 * turn source: what is sent, how often, and what the pill shows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PillView } from "@/core/live/client";
import type { Stage } from "@/core/live/health";
import { PILL_TEXT } from "@/core/live/pill";
import { scriptTurnSource } from "@/lib/live/script-source";
import { type FinishedTurn, type TurnSource, runCall } from "@/lib/live/session";

interface Sent {
  path: string;
  key: string | null;
  body: Record<string, unknown>;
}

type Answer = { status: number; body: unknown };
type Responder = (path: string, body: Record<string, unknown>) => Answer | undefined;

const CALL = "call_1";
const ok = (body: unknown): Answer => ({ status: 200, body });
const fail = (status: number, code: string): Answer => ({ status, body: { error: { code, message: code } } });
const decision = (seq: number, level: "listening" | "amber" | "red" = "listening") => ok({ seq, pill: { level, text: "" }, decidedAt: "", readStatus: "read" });

let sent: Sent[];
let responders: Responder[];

/** Answers with the first responder that has something to say, else a plain success for the route. */
function stubFetch() {
  vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
    const headers = init.headers as Record<string, string>;
    sent.push({ path, key: headers["Idempotency-Key"] ?? null, body });
    let answer: Answer | undefined;
    for (const r of responders) if ((answer = r(path, body))) break;
    if (!answer) {
      if (path === "/api/calls") answer = { status: 201, body: { call: { id: CALL, status: "live", startedAt: "" } } };
      else if (path.endsWith("/turns")) answer = decision(body.seq as number);
      else if (path.endsWith("/end")) answer = ok({ hiddenCount: 0, pillText: "", jobId: null, transcriptVersionId: null });
      else answer = ok({ ok: true });
    }
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
}

function scripted() {
  let onTurn: ((t: FinishedTurn) => void) | null = null;
  let onStage: ((stage: Stage, up: boolean, cause?: string) => void) | null = null;
  const stop = vi.fn<() => void>();
  const source: TurnSource & { stop: typeof stop } = {
    async start(t, s) {
      onTurn = t;
      onStage = s;
    },
    stop,
  };
  return {
    source,
    turn: (text: string, speaker: FinishedTurn["speaker"] = "expert") => onTurn!({ speaker, text, speechStartMs: 0, speechEndMs: 1000, transcribedAtMs: Date.now() }),
    stage: (stage: Stage, up: boolean, cause?: string) => onStage!(stage, up, cause),
  };
}

const views: PillView[] = [];
const only = (suffix: string) => sent.filter((s) => s.path.endsWith(suffix));
const settle = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

async function start() {
  const s = scripted();
  const call = await runCall({ caseId: "case_1", source: s.source, onView: (v) => views.push(v) });
  return { ...s, call };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-11-10T10:00:00.000Z") });
  sent = [];
  responders = [];
  views.length = 0;
  stubFetch();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("runCall", () => {
  it("numbers turns in order and shows the decision, then acknowledges it", async () => {
    responders.push((p, b) => (p.endsWith("/turns") && b.seq === 2 ? decision(2, "red") : undefined));
    const { turn } = await start();
    turn("First thing.");
    turn("Second thing.");
    await settle(10);
    expect(only("/turns").map((s) => s.body.seq)).toEqual([1, 2]);
    expect(views.at(-1)).toEqual({ level: "red", text: PILL_TEXT.red });
    expect(only("/acks").map((s) => s.body.seq)).toEqual([1, 2]);
  });

  it("sends the same seq and key again after a 5xx, never renumbering, and records one reading outage", async () => {
    let failures = 2;
    responders.push((p) => (p.endsWith("/turns") && failures-- > 0 ? fail(503, "BUSY") : undefined));
    const { turn } = await start();
    turn("First thing.");
    await settle(250 + 500 + 10); // two retries with backoff 250 ms then 500 ms
    turn("Second thing.");
    await settle(10);

    const turns = only("/turns");
    expect(turns.map((s) => s.body.seq)).toEqual([1, 1, 1, 2]);
    expect(new Set(turns.slice(0, 3).map((s) => s.key)).size).toBe(1);
    expect(turns[3].key).not.toBe(turns[0].key);
    expect(turns.slice(0, 3).every((s) => s.body.text === "First thing.")).toBe(true);

    const outages = only("/outages");
    expect(outages).toHaveLength(1);
    expect(outages[0].body).toMatchObject({ stage: "reading", shownToBanker: false });
    expect(outages[0].body.cause).toMatch(/503/);
    expect(outages[0].body.endedAt).not.toBeNull();
  });

  it("posts exactly one outage per stage that goes down and comes back", async () => {
    const { stage } = await start();
    stage("hearing", false, "the microphone track ended");
    stage("hearing", false, "said again");
    await settle(1000);
    stage("hearing", true);
    stage("hearing", true);
    stage("transcribing", true); // never went down
    await settle(10);
    const outages = only("/outages");
    expect(outages).toHaveLength(1);
    expect(outages[0].body).toMatchObject({ stage: "hearing", cause: "the microphone track ended", startedAt: "2026-11-10T10:00:00.000Z", endedAt: "2026-11-10T10:00:01.000Z", shownToBanker: false });
  });

  it("tells onStage each time a stage goes down and comes back, once each", async () => {
    const s = scripted();
    const heard: string[] = [];
    await runCall({ caseId: "case_1", source: s.source, onView: () => undefined, onStage: (stage, up) => heard.push(`${stage} ${up ? "up" : "down"}`) });
    s.stage("hearing", false, "the microphone track ended");
    s.stage("hearing", false, "said again");
    s.stage("hearing", true);
    s.stage("transcribing", true); // never went down
    expect(heard).toEqual(["hearing down", "hearing up"]);
  });

  it("marks an outage shown to the banker when the pill was broken during it", async () => {
    const { stage } = await start();
    stage("transcribing", false, "closed");
    await settle(3500);
    expect(views.at(-1)?.level).toBe("broken");
    stage("transcribing", true);
    await settle(10);
    expect(only("/outages")[0].body.shownToBanker).toBe(true);
    expect(views.at(-1)?.level).toBe("listening");
  });

  it("retries an outage post with the same idempotency key", async () => {
    let failures = 1;
    responders.push((p) => (p.endsWith("/outages") && failures-- > 0 ? fail(502, "UPSTREAM") : undefined));
    const { stage } = await start();
    stage("hearing", false, "x");
    stage("hearing", true);
    await settle(300);
    const outages = only("/outages");
    expect(outages).toHaveLength(2);
    expect(outages[0].key).toBe(outages[1].key);
  });

  it("a 401 on a turn stops the call and leaves the pill broken", async () => {
    responders.push((p) => (p.endsWith("/turns") ? fail(401, "UNAUTHENTICATED") : undefined));
    const { turn, source } = await start();
    turn("First thing.");
    await settle(10);
    expect(views.at(-1)).toEqual({ level: "broken", text: PILL_TEXT.broken });
    expect(source.stop).toHaveBeenCalled();
    turn("Second thing.");
    await settle(20_000);
    expect(only("/turns")).toHaveLength(1);
    expect(views.at(-1)?.level).toBe("broken");
    expect(only("/outages")).toHaveLength(0); // the server would refuse it too
  });

  it("a refusal the server can still record (409 TURN_CONFLICT) stops the call and records an open reading outage", async () => {
    responders.push((p) => (p.endsWith("/turns") ? fail(409, "TURN_CONFLICT") : undefined));
    const { turn } = await start();
    turn("First thing.");
    await settle(10);
    expect(views.at(-1)?.level).toBe("broken");
    const outages = only("/outages");
    expect(outages).toHaveLength(1);
    expect(outages[0].body).toMatchObject({ stage: "reading", endedAt: null, shownToBanker: true });
    expect(outages[0].body.cause).toMatch(/409 \(TURN_CONFLICT\)/);
  });

  it("a 2xx reply it cannot read is not retried: no decision, one reading outage, and the next turn goes on", async () => {
    responders.push((p, b) => (p.endsWith("/turns") && b.seq === 1 ? ok({ nonsense: true }) : undefined));
    const { turn } = await start();
    turn("First thing.");
    await settle(10);
    turn("Second thing.");
    await settle(10_000);
    expect(only("/turns").map((s) => s.body.seq)).toEqual([1, 2]);
    expect(only("/acks").map((s) => s.body.seq)).toEqual([2]);
    const outages = only("/outages");
    expect(outages).toHaveLength(1);
    expect(outages[0].body).toMatchObject({ stage: "reading" });
    expect(outages[0].body.cause).toMatch(/turn 1 could not be read/);
    expect(views.at(-1)?.level).toBe("listening");
  });

  it("a turn slower than 3 s marks reading down and is sent again with the same seq", async () => {
    let slow = true;
    vi.stubGlobal("fetch", async (path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      sent.push({ path, key: (init.headers as Record<string, string>)["Idempotency-Key"], body });
      if (path === "/api/calls") return new Response(JSON.stringify({ call: { id: CALL } }), { status: 201 });
      if (path.endsWith("/turns") && slow) {
        slow = false;
        return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      }
      if (path.endsWith("/turns")) return new Response(JSON.stringify({ seq: body.seq, pill: { level: "listening", text: "" } }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    const { turn } = await start();
    turn("First thing.");
    await settle(3000 + 250 + 10);
    const turns = only("/turns");
    expect(turns.map((s) => s.body.seq)).toEqual([1, 1]);
    expect(turns[0].key).toBe(turns[1].key);
    expect(only("/outages")[0].body.cause).toMatch(/took more than 3 s/);
  });

  it("end() posts the open outages, then ends the call and shows the count", async () => {
    responders.push((p) => (p.endsWith("/end") ? ok({ hiddenCount: 2 }) : undefined));
    const { stage, call, source } = await start();
    stage("hearing", false, "the computer audio track ended");
    const ending = call.end();
    await settle(2000 + 100);
    await ending;
    expect(source.stop).toHaveBeenCalled();
    const paths = sent.map((s) => s.path);
    expect(paths.indexOf(`/api/calls/${CALL}/outages`)).toBeLessThan(paths.indexOf(`/api/calls/${CALL}/end`));
    expect(only("/outages")[0].body).toMatchObject({ stage: "hearing", endedAt: null });
    expect(views.at(-1)).toEqual({ level: "ended", text: "Call ended. 2 passages hidden and sent to compliance." });
    await settle(10_000);
    expect(views.at(-1)?.level).toBe("idle");
  });
});

describe("scriptTurnSource", () => {
  const SCRIPT = [
    { speaker: "analyst" as const, text: "First question." },
    { speaker: "expert" as const, text: "First answer." },
    { speaker: "analyst" as const, text: "Thanks." },
  ];

  it("hands over one turn every pace, timed from start(), and is done after the last", async () => {
    const source = scriptTurnSource(SCRIPT, 150);
    const turns: FinishedTurn[] = [];
    let done = false;
    void source.done.then(() => (done = true));
    await source.start((t) => turns.push(t), () => undefined);
    await settle(149);
    expect(turns).toHaveLength(0);
    await settle(1);
    expect(turns).toHaveLength(1);
    await settle(300);
    expect(done).toBe(true);
    expect(turns.map((t) => [t.speaker, t.text, t.speechStartMs, t.speechEndMs])).toEqual([
      ["analyst", "First question.", 0, 150],
      ["expert", "First answer.", 150, 300],
      ["analyst", "Thanks.", 300, 450],
    ]);
    expect(turns[2].transcribedAtMs).toBe(Date.parse("2026-11-10T10:00:00.450Z"));
  });

  it("stop() hands over nothing more and is done at once", async () => {
    const source = scriptTurnSource(SCRIPT, 150);
    const turns: FinishedTurn[] = [];
    await source.start((t) => turns.push(t), () => undefined);
    await settle(150);
    source.stop();
    await source.done;
    await settle(1000);
    expect(turns).toHaveLength(1);
  });

  it("drives a whole call through runCall: every turn sent in order with its own times", async () => {
    const source = scriptTurnSource(SCRIPT, 150);
    await runCall({ caseId: "case_1", source, onView: (v) => views.push(v) });
    await settle(500);
    const bodies = only("/turns").map((s) => s.body);
    expect(bodies.map((b) => [b.seq, b.speaker, b.text, b.speechStartMs, b.speechEndMs])).toEqual([
      [1, "analyst", "First question.", 0, 150],
      [2, "expert", "First answer.", 150, 300],
      [3, "analyst", "Thanks.", 300, 450],
    ]);
  });
});
