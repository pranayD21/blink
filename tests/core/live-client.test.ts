import { describe, expect, it } from "vitest";
import { type ClientEvent, INITIAL_CLIENT, reduceClient } from "@/core/live/client";
import { PILL_TEXT, endedText } from "@/core/live/pill";

const run = (...events: ClientEvent[]) => events.reduce(reduceClient, INITIAL_CLIENT);
const started: ClientEvent = { type: "started" };

describe("reduceClient", () => {
  it("starts idle with no text, and listening once started", () => {
    expect(INITIAL_CLIENT.shown).toEqual({ level: "idle", text: "" });
    expect(run(started).shown).toEqual({ level: "listening", text: PILL_TEXT.listening });
  });
  it("shows a warning and returns to listening after exactly 6000 ms", () => {
    const s = run(started, { type: "decision", level: "amber", atMs: 1000 });
    expect(s.shown).toEqual({ level: "amber", text: PILL_TEXT.amber });
    expect(reduceClient(s, { type: "tick", nowMs: 6999 }).shown.level).toBe("amber");
    expect(reduceClient(s, { type: "tick", nowMs: 7000 }).shown).toEqual({ level: "listening", text: PILL_TEXT.listening });
  });
  it("a listening decision changes nothing", () => {
    const s = run(started, { type: "decision", level: "red", atMs: 0 });
    expect(reduceClient(s, { type: "decision", level: "listening", atMs: 100 })).toEqual(s);
  });
  it("red replaces amber at once", () => {
    const s = run(started, { type: "decision", level: "amber", atMs: 0 }, { type: "decision", level: "red", atMs: 500 });
    expect(s.shown).toEqual({ level: "red", text: PILL_TEXT.red });
    expect(s.warningUntilMs).toBe(6500);
  });
  it("amber does not replace a red still showing", () => {
    const s = run(started, { type: "decision", level: "red", atMs: 0 }, { type: "decision", level: "amber", atMs: 2000 });
    expect(s.shown.level).toBe("red");
    expect(s.warningUntilMs).toBe(6000);
  });
  it("amber replaces a red that has run out", () => {
    const s = run(started, { type: "decision", level: "red", atMs: 0 }, { type: "decision", level: "amber", atMs: 6000 });
    expect(s.shown.level).toBe("amber");
  });
  it("broken replaces everything once a stage is down more than 3000 ms, and clears on stage_up", () => {
    let s = run(started, { type: "decision", level: "amber", atMs: 0 }, { type: "stage_down", stage: "hearing", atMs: 1000 });
    expect(s.shown.level).toBe("amber");
    s = reduceClient(s, { type: "tick", nowMs: 4000 });
    expect(s.shown.level).toBe("amber");
    s = reduceClient(s, { type: "tick", nowMs: 4001 });
    expect(s.shown).toEqual({ level: "broken", text: PILL_TEXT.broken });
    s = reduceClient(s, { type: "stage_up", stage: "hearing" });
    expect(s.shown.level).toBe("listening");
    expect(s.downSinceMs).toEqual({});
  });
  it("a red already showing runs its full 6000 ms before broken takes over", () => {
    let s = run(started, { type: "decision", level: "red", atMs: 0 }, { type: "stage_down", stage: "hearing", atMs: 1000 });
    s = reduceClient(s, { type: "tick", nowMs: 4001 });
    expect(s.shown.level).toBe("red");
    s = reduceClient(s, { type: "tick", nowMs: 6000 });
    expect(s.shown).toEqual({ level: "broken", text: PILL_TEXT.broken });
  });
  it("a red decision while broken shows red for 6000 ms, then broken again while the stage is still down", () => {
    let s = run(started, { type: "stage_down", stage: "transcribing", atMs: 0 }, { type: "tick", nowMs: 3500 });
    expect(s.shown.level).toBe("broken");
    s = reduceClient(s, { type: "decision", level: "red", atMs: 4000 });
    expect(s.shown).toEqual({ level: "red", text: PILL_TEXT.red });
    expect(s.warningUntilMs).toBe(10000);
    s = reduceClient(s, { type: "tick", nowMs: 9999 });
    expect(s.shown.level).toBe("red");
    s = reduceClient(s, { type: "tick", nowMs: 10000 });
    expect(s.shown).toEqual({ level: "broken", text: PILL_TEXT.broken });
  });
  it("a red decision while broken returns to listening, not broken, if the stage came back meanwhile", () => {
    let s = run(started, { type: "stage_down", stage: "transcribing", atMs: 0 }, { type: "tick", nowMs: 3500 }, { type: "decision", level: "red", atMs: 4000 });
    s = reduceClient(s, { type: "stage_up", stage: "transcribing" });
    expect(s.shown.level).toBe("red");
    s = reduceClient(s, { type: "tick", nowMs: 10000 });
    expect(s.shown).toEqual({ level: "listening", text: PILL_TEXT.listening });
  });
  it("an amber decision while broken stays broken", () => {
    const s = run(started, { type: "stage_down", stage: "reading", atMs: 0 }, { type: "tick", nowMs: 3500 }, { type: "decision", level: "amber", atMs: 4000 });
    expect(s.shown).toEqual({ level: "broken", text: PILL_TEXT.broken });
    expect(s.warningUntilMs).toBeNull();
  });
  it("stage_up with another stage still down more than 3000 ms stays broken", () => {
    let s = run(started, { type: "stage_down", stage: "hearing", atMs: 0 }, { type: "stage_down", stage: "reading", atMs: 500 }, { type: "tick", nowMs: 4000 });
    expect(s.shown.level).toBe("broken");
    s = reduceClient(s, { type: "stage_up", stage: "hearing" });
    expect(s.shown.level).toBe("broken");
    s = reduceClient(s, { type: "tick", nowMs: 4250 });
    expect(s.shown).toEqual({ level: "broken", text: PILL_TEXT.broken });
    expect(s.downSinceMs).toEqual({ reading: 500 });
  });
  it("a stage that comes back inside 3 seconds never shows broken", () => {
    const s = run(started, { type: "stage_down", stage: "screen", atMs: 0 }, { type: "tick", nowMs: 2000 }, { type: "stage_up", stage: "screen" }, { type: "tick", nowMs: 9000 });
    expect(s.shown.level).toBe("listening");
  });
  it("keeps the earliest down time when a stage reports down twice", () => {
    const s = run(started, { type: "stage_down", stage: "reading", atMs: 0 }, { type: "stage_down", stage: "reading", atMs: 2500 }, { type: "tick", nowMs: 3001 });
    expect(s.shown.level).toBe("broken");
  });
  it("ended shows for 10000 ms and then idle", () => {
    const s = run(started, { type: "ended", hiddenCount: 2, atMs: 5000 });
    expect(s.shown).toEqual({ level: "ended", text: endedText(2) });
    expect(reduceClient(s, { type: "tick", nowMs: 14999 }).shown.level).toBe("ended");
    expect(reduceClient(s, { type: "tick", nowMs: 15000 }).shown).toEqual({ level: "idle", text: "" });
  });
  it("ended is not displaced by a late stage report or decision", () => {
    const s = run(started, { type: "ended", hiddenCount: 0, atMs: 0 }, { type: "stage_down", stage: "hearing", atMs: 1 }, { type: "decision", level: "red", atMs: 2 }, { type: "tick", nowMs: 9000 });
    expect(s.shown.text).toBe("Call ended. Nothing was hidden.");
  });
  it("ignores decisions before the call starts", () => expect(run({ type: "decision", level: "red", atMs: 0 }).shown.level).toBe("idle"));
});
