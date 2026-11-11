/**
 * The Flux client and the live source in node: a fake WebSocket, a mocked audio module and fake
 * timers. Covers when sockets open, how reconnects back off, and where a dead audio pipeline lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
  pcmFrames: vi.fn(),
  captureChannels: vi.fn(),
  captureMicrophone: vi.fn(),
}));
vi.mock("@/lib/live/audio", () => ({ FRAME_MS: 80, SAMPLE_RATE: 16000, FRAME_SAMPLES: 1280, ...audio }));

import { RECONNECT_FIRST_MS, STABLE_AFTER_MS, openFlux } from "@/lib/live/flux-client";
import { liveTurnSource } from "@/lib/live/session";

class FakeSocket {
  static OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 0;
  binaryType = "blob";
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    FakeSocket.all.push(this);
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  message(data: string) {
    this.onmessage?.({ data });
  }
}

const stream = {} as MediaStream;
const flush = () => vi.advanceTimersByTimeAsync(0);
const turnInfo = JSON.stringify({ type: "TurnInfo", event: "Update", turn_index: 0, transcript: "hi" });

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  audio.pcmFrames.mockReset().mockResolvedValue({ stop: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("openFlux", () => {
  it("opens the socket only once the audio pipeline is running, with the grant token as a bearer subprotocol", async () => {
    let ready!: (v: { stop(): void }) => void;
    audio.pcmFrames.mockReturnValue(new Promise((r) => (ready = r)));
    openFlux("tok", stream, () => undefined, () => undefined);
    await flush();
    expect(FakeSocket.all).toHaveLength(0);
    ready({ stop: vi.fn() });
    await flush();
    expect(FakeSocket.all).toHaveLength(1);
    expect(FakeSocket.all[0].protocols).toEqual(["bearer", "tok"]);
  });

  it("a failed audio pipeline opens no socket and reports through onAudioFailed, never as transcribing up", async () => {
    audio.pcmFrames.mockRejectedValue(new DOMException("no worklet", "AbortError"));
    const onState = vi.fn();
    const onAudioFailed = vi.fn();
    openFlux("tok", stream, () => undefined, onState, { onAudioFailed });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeSocket.all).toHaveLength(0);
    expect(onAudioFailed).toHaveBeenCalledTimes(1);
    expect(onAudioFailed.mock.calls[0][0]).toMatch(/audio could not be prepared/);
    expect(onState).not.toHaveBeenCalled();
  });

  it("keeps doubling the backoff for sockets that open and drop at once", async () => {
    const mint = vi.fn(async () => "fresh");
    openFlux("tok", stream, () => undefined, () => undefined, { mint });
    await flush();
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      const sock = FakeSocket.all.at(-1)!;
      sock.open();
      sock.drop();
      const before = FakeSocket.all.length;
      let waited = 0;
      while (FakeSocket.all.length === before) {
        await vi.advanceTimersByTimeAsync(50);
        waited += 50;
      }
      delays.push(waited);
    }
    expect(delays).toEqual([250, 500, 1000, 2000, 4000]);
    expect(mint).toHaveBeenCalledTimes(5);
    expect(FakeSocket.all.at(-1)!.protocols).toEqual(["bearer", "fresh"]);
  });

  /** Drops the current socket and returns how long the reconnect took. */
  async function dropAndTime() {
    const before = FakeSocket.all.length;
    FakeSocket.all.at(-1)!.drop();
    let waited = 0;
    while (FakeSocket.all.length === before) {
      await vi.advanceTimersByTimeAsync(50);
      waited += 50;
    }
    return waited;
  }

  it("resets the backoff after a socket has stayed open 5 s", async () => {
    openFlux("tok", stream, () => undefined, () => undefined, { mint: async () => "t" });
    await flush();
    FakeSocket.all[0].open();
    expect(await dropAndTime()).toBe(250);
    FakeSocket.all.at(-1)!.open();
    expect(await dropAndTime()).toBe(500);
    FakeSocket.all.at(-1)!.open();
    await vi.advanceTimersByTimeAsync(STABLE_AFTER_MS);
    expect(await dropAndTime()).toBe(RECONNECT_FIRST_MS);
  });

  it("resets the backoff on the first transcript message, but not on Flux's Connected greeting", async () => {
    openFlux("tok", stream, () => undefined, () => undefined, { mint: async () => "t" });
    await flush();
    FakeSocket.all[0].open();
    expect(await dropAndTime()).toBe(250);
    FakeSocket.all.at(-1)!.open();
    FakeSocket.all.at(-1)!.message(JSON.stringify({ type: "Connected" }));
    expect(await dropAndTime()).toBe(500);
    FakeSocket.all.at(-1)!.open();
    FakeSocket.all.at(-1)!.message(turnInfo);
    expect(await dropAndTime()).toBe(RECONNECT_FIRST_MS);
  });

  it("reports an end of turn with no audio window as a momentary outage, and does not pass it on", async () => {
    const onMessage = vi.fn();
    const onState = vi.fn();
    openFlux("tok", stream, onMessage, onState);
    await flush();
    FakeSocket.all[0].open();
    FakeSocket.all[0].message(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", turn_index: 0, transcript: "lost words" }));
    expect(onMessage).not.toHaveBeenCalled();
    expect(onState.mock.calls).toEqual([[true], [false, expect.stringMatching(/without its audio times/)], [true]]);
  });
});

describe("liveTurnSource", () => {
  const track = { readyState: "live", addEventListener: vi.fn(), stop: vi.fn() };
  const fakeStream = (name: string) => ({ name, getAudioTracks: () => [track], getTracks: () => [track] }) as unknown as MediaStream;

  beforeEach(() => {
    const analyst = fakeStream("analyst");
    const expert = fakeStream("expert");
    audio.captureChannels.mockResolvedValue({ analyst, expert, stop: vi.fn() });
    audio.captureMicrophone.mockResolvedValue(analyst);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ accessToken: "t", expiresIn: 30 }), { status: 200 }));
  });

  it("in solo mode captures only the microphone and tags turns with soloSpeaker", async () => {
    audio.pcmFrames.mockResolvedValue({ stop: vi.fn() });
    const turns: unknown[] = [];
    const onStage = vi.fn();
    let role: "expert" | "analyst" = "expert";
    const src = liveTurnSource("call_solo", { mode: "solo", soloSpeaker: () => role });
    await src.start((t) => turns.push(t), onStage);
    await flush();
    expect(audio.captureMicrophone).toHaveBeenCalledTimes(1);
    expect(FakeSocket.all).toHaveLength(1);
    FakeSocket.all[0].open();
    FakeSocket.all[0].message(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", turn_index: 0, audio_window_start: 0, audio_window_end: 1.5, transcript: "Q3 bookings fell twenty percent." }));
    role = "analyst";
    FakeSocket.all[0].message(JSON.stringify({ type: "TurnInfo", event: "EndOfTurn", turn_index: 1, audio_window_start: 2, audio_window_end: 3.5, transcript: "Are Halvorsen bookings down?" }));
    expect(turns).toMatchObject([
      { speaker: "expert", text: "Q3 bookings fell twenty percent." },
      { speaker: "analyst", text: "Are Halvorsen bookings down?" },
    ]);
    expect(onStage.mock.calls.filter(([, up]) => !up)).toEqual([]);
    src.stop();
  });

  it("puts a dead audio pipeline under hearing, which no socket opening can clear", async () => {
    audio.pcmFrames.mockImplementation(async (s: { name: string }) => {
      if (s.name === "analyst") throw new DOMException("no worklet", "NotSupportedError");
      return { stop: vi.fn() };
    });
    const onStage = vi.fn();
    await liveTurnSource("call_1").start(() => undefined, onStage);
    await flush();
    expect(FakeSocket.all).toHaveLength(1); // only the expert channel has a socket
    FakeSocket.all[0].open();
    FakeSocket.all[0].drop();
    await vi.advanceTimersByTimeAsync(300);
    FakeSocket.all.at(-1)!.open();
    const hearing = onStage.mock.calls.filter(([stage]) => stage === "hearing");
    expect(hearing).toEqual([["hearing", false, expect.stringMatching(/^microphone: the audio could not be prepared/)]]);
  });
});
