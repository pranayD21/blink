/** The control page's choice of turn source: the scripted call only where it is allowed. */
import { describe, expect, it } from "vitest";
import { DEFAULT_PACE_MS, controlSourceOf } from "@/lib/live/control-source";

describe("controlSourceOf", () => {
  it("falls back to the live source when ?source=script is given but scripted calls are not allowed", () => {
    expect(controlSourceOf({ source: "script", pace: "150" }, false)).toEqual({ kind: "live" });
    expect(controlSourceOf({ source: ["script"], pace: "150" }, false)).toEqual({ kind: "live" });
  });

  it("uses the script only with ?source=script where allowed", () => {
    expect(controlSourceOf({ source: "script", pace: "150" }, true)).toEqual({ kind: "script", paceMs: 150 });
    expect(controlSourceOf({}, true)).toEqual({ kind: "live" });
    expect(controlSourceOf({ source: "live" }, true)).toEqual({ kind: "live" });
  });

  it("holds the pace between 50 ms and 10 s, with a default for anything unreadable", () => {
    expect(controlSourceOf({ source: "script", pace: "5" }, true)).toEqual({ kind: "script", paceMs: 50 });
    expect(controlSourceOf({ source: "script", pace: "999999" }, true)).toEqual({ kind: "script", paceMs: 10_000 });
    expect(controlSourceOf({ source: "script", pace: "fast" }, true)).toEqual({ kind: "script", paceMs: DEFAULT_PACE_MS });
    expect(controlSourceOf({ source: "script" }, true)).toEqual({ kind: "script", paceMs: DEFAULT_PACE_MS });
  });
});
