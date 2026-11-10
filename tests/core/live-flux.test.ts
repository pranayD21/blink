import { describe, expect, it } from "vitest";
import { isEndWithoutWindow, parseFluxMessage } from "@/core/live/flux";

const msg = (o: Record<string, unknown>) => JSON.stringify({ type: "TurnInfo", turn_index: 3, transcript: "hello there", ...o });

describe("parseFluxMessage", () => {
  it("reads an end of turn with its audio window in whole milliseconds", () =>
    expect(parseFluxMessage('{"type":"TurnInfo","event":"EndOfTurn","turn_index":3,"transcript":"hello there","audio_window_start":1.5,"audio_window_end":2.75}')).toEqual({
      kind: "end", turnIndex: 3, transcript: "hello there", audioStartMs: 1500, audioEndMs: 2750,
    }));
  it("rounds to an integer", () =>
    expect(parseFluxMessage(msg({ event: "EagerEndOfTurn", audio_window_start: 0, audio_window_end: 0.47999996 }))).toMatchObject({ kind: "eager_end", audioEndMs: 480 }));
  it("reads update, start and resumed", () => {
    expect(parseFluxMessage(msg({ event: "Update" }))).toEqual({ kind: "update", turnIndex: 3, transcript: "hello there" });
    expect(parseFluxMessage(msg({ event: "StartOfTurn" }))).toEqual({ kind: "start", turnIndex: 3 });
    expect(parseFluxMessage(msg({ event: "TurnResumed" }))).toEqual({ kind: "resumed", turnIndex: 3 });
  });
  it("treats anything else as other", () => {
    expect(parseFluxMessage("not json")).toEqual({ kind: "other" });
    expect(parseFluxMessage('{"type":"Connected"}')).toEqual({ kind: "other" });
    expect(parseFluxMessage("null")).toEqual({ kind: "other" });
    expect(parseFluxMessage(msg({ event: "EndOfTurn" }))).toEqual({ kind: "other" });
    expect(parseFluxMessage(msg({ event: "Nope" }))).toEqual({ kind: "other" });
  });
});

describe("isEndWithoutWindow", () => {
  it("is true for an end of turn that lacks its audio window, which parseFluxMessage cannot use", () => {
    expect(isEndWithoutWindow(msg({ event: "EndOfTurn" }))).toBe(true);
    expect(isEndWithoutWindow(msg({ event: "EndOfTurn", audio_window_start: 1 }))).toBe(true);
  });
  it("is false for a complete end, an eager end, other events and junk", () => {
    expect(isEndWithoutWindow(msg({ event: "EndOfTurn", audio_window_start: 1, audio_window_end: 2 }))).toBe(false);
    expect(isEndWithoutWindow(msg({ event: "EagerEndOfTurn" }))).toBe(false);
    expect(isEndWithoutWindow(msg({ event: "Update" }))).toBe(false);
    expect(isEndWithoutWindow('{"type":"Connected"}')).toBe(false);
    expect(isEndWithoutWindow("not json")).toBe(false);
  });
});
