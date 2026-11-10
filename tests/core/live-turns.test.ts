import { describe, expect, it } from "vitest";
import type { FluxEvent } from "@/core/live/flux";
import { type ChannelEvent, ECHO_WINDOW_MS, type LevelSample, createHearingWatch, createTurnAssembler } from "@/core/live/turns";

const end = (transcript: string, audioStartMs: number, audioEndMs: number, turnIndex = 0): FluxEvent => ({ kind: "end", turnIndex, transcript, audioStartMs, audioEndMs });
const on = (channel: ChannelEvent["channel"], event: FluxEvent, atMs: number): ChannelEvent => ({ channel, event, atMs });

describe("createTurnAssembler", () => {
  it("emits a turn on EndOfTurn with the channel's speaker and clocks", () => {
    const a = createTurnAssembler();
    expect(a.push(on("expert", end("Orders were soft in the quarter.", 1000, 2750), 1_700_000_004_500))).toEqual([
      { speaker: "expert", text: "Orders were soft in the quarter.", speechStartMs: 1000, speechEndMs: 2750, transcribedAtMs: 1_700_000_004_500 },
    ]);
  });

  it("ignores eager ends, updates and empty transcripts", () => {
    const a = createTurnAssembler();
    const pushed = [
      a.push(on("expert", { kind: "eager_end", turnIndex: 0, transcript: "Orders were soft", audioStartMs: 0, audioEndMs: 900 }, 10)),
      a.push(on("expert", { kind: "update", turnIndex: 0, transcript: "Orders were" }, 11)),
      a.push(on("expert", { kind: "start", turnIndex: 1 }, 12)),
      a.push(on("expert", { kind: "resumed", turnIndex: 1 }, 13)),
      a.push(on("expert", { kind: "other" }, 14)),
      a.push(on("analyst", end("   ", 0, 900), 15)),
      a.push(on("expert", end("", 0, 900), 16)),
    ];
    expect(pushed.flat()).toEqual([]);
  });

  it("trims the transcript it emits", () => {
    expect(createTurnAssembler().push(on("analyst", end("  How is demand?  ", 0, 900), 5))[0].text).toBe("How is demand?");
  });

  it("drops a microphone turn that echoes the far side within four seconds", () => {
    const a = createTurnAssembler();
    const expert = a.push(on("expert", end("Distributors told us orders fell twenty percent in October.", 0, 3000), 10_000));
    const echo = a.push(on("analyst", end("orders fell twenty percent in October", 200, 3100), 11_200));
    expect(expert.map((t) => t.speaker)).toEqual(["expert"]);
    expect(echo).toEqual([]);
  });

  it("checks an echo against every far-side turn inside the window, not only the last", () => {
    const a = createTurnAssembler();
    a.push(on("expert", end("Distributors told us orders fell.", 0, 2000), 10_000));
    a.push(on("expert", end("It was twenty percent in October.", 2100, 3500), 11_000));
    expect(a.push(on("analyst", end("orders fell it was twenty percent", 0, 3400), 12_000))).toEqual([]);
  });

  it("keeps a microphone turn that echoes words heard more than four seconds earlier", () => {
    const a = createTurnAssembler();
    a.push(on("expert", end("Distributors told us orders fell twenty percent in October.", 0, 3000), 10_000));
    expect(a.push(on("analyst", end("orders fell twenty percent in October", 200, 3100), 10_000 + ECHO_WINDOW_MS + 1))).toHaveLength(1);
  });

  it("keeps a microphone turn that says something else", () => {
    const a = createTurnAssembler();
    const out = [
      ...a.push(on("expert", end("Distributors told us orders fell twenty percent in October.", 0, 3000), 10_000)),
      ...a.push(on("analyst", end("Which distributors were those, roughly?", 3500, 5200), 11_200)),
    ];
    expect(out.map((t) => [t.speaker, t.text])).toEqual([
      ["expert", "Distributors told us orders fell twenty percent in October."],
      ["analyst", "Which distributors were those, roughly?"],
    ]);
  });

  it("never drops a far-side turn, even when it repeats the banker's words", () => {
    const a = createTurnAssembler();
    a.push(on("analyst", end("Did orders fall in October?", 0, 1500), 10_000));
    expect(a.push(on("expert", end("Orders did fall in October.", 1600, 3000), 10_500))).toHaveLength(1);
  });
});

describe("createHearingWatch", () => {
  const level = (channel: LevelSample["channel"], peak: number, atMs: number): LevelSample => ({ channel, peak, atMs });

  /** Feeds 80 ms frames on both channels from `fromMs` to `toMs`; returns every change reported. */
  function feed(w: ReturnType<typeof createHearingWatch>, fromMs: number, toMs: number, micPeak: number, systemPeak: number) {
    const changes: { atMs: number; change: "down" | "up" }[] = [];
    for (let t = fromMs; t < toMs; t += 80) {
      for (const s of [level("analyst", micPeak, t), level("expert", systemPeak, t)]) {
        const change = w.push(s);
        if (change) changes.push({ atMs: t, change });
      }
    }
    return changes;
  }

  it("marks hearing down after three seconds of exact zeros on the system channel while the microphone hears speech", () => {
    const w = createHearingWatch();
    const changes = feed(w, 0, 4000, 0.3, 0);
    expect(changes).toEqual([{ atMs: 3040, change: "down" }]);
  });

  it("does not mark hearing down when the microphone is quiet too", () => expect(feed(createHearingWatch(), 0, 10_000, 0.001, 0)).toEqual([]));

  it("does not mark hearing down while the system channel carries any signal, however faint", () => expect(feed(createHearingWatch(), 0, 10_000, 0.3, 0.00001)).toEqual([]));

  it("brings hearing back up on the first system frame that is not exactly zero", () => {
    const w = createHearingWatch();
    feed(w, 0, 4000, 0.3, 0);
    expect(w.push(level("expert", 0.01, 4000))).toBe("up");
    expect(w.push(level("expert", 0.01, 4080))).toBeNull();
  });

  it("starts the three seconds from the first zero frame, and needs speech inside that span", () => {
    const w = createHearingWatch();
    feed(w, 0, 1000, 0.3, 0.2); // speech on both before the system channel dies
    expect(feed(w, 1000, 5000, 0.001, 0)).toEqual([]); // dead for four seconds, but the banker is silent
    expect(feed(w, 5000, 5200, 0.3, 0)).toEqual([{ atMs: 5000, change: "down" }]); // the banker speaks into a dead channel
  });
});
