/** What the pill shows on the banker's screen, as a pure state machine over events and clock readings. */
import { type Stage, brokenStage } from "./health";
import { PILL_TEXT, type PillLevel, WARNING_VISIBLE_MS, endedText } from "./pill";

export type PillView = { level: "idle" | "listening" | "amber" | "red" | "broken" | "ended"; text: string };

export interface ClientState {
  shown: PillView;
  warningUntilMs: number | null;
  endedUntilMs: number | null;
  downSinceMs: Partial<Record<Stage, number>>;
}

export type ClientEvent =
  | { type: "started" }
  | { type: "decision"; level: PillLevel; atMs: number }
  | { type: "tick"; nowMs: number }
  | { type: "stage_down"; stage: Stage; atMs: number }
  | { type: "stage_up"; stage: Stage }
  | { type: "ended"; hiddenCount: number; atMs: number };

export const ENDED_VISIBLE_MS = 10000;

const IDLE: PillView = { level: "idle", text: "" };
const LISTENING: PillView = { level: "listening", text: PILL_TEXT.listening };
const BROKEN: PillView = { level: "broken", text: PILL_TEXT.broken };

export const INITIAL_CLIENT: ClientState = { shown: IDLE, warningUntilMs: null, endedUntilMs: null, downSinceMs: {} };

const live = (s: ClientState) => s.shown.level !== "idle" && s.shown.level !== "ended";
const redShowing = (s: ClientState, nowMs: number) => s.shown.level === "red" && s.warningUntilMs !== null && nowMs < s.warningUntilMs;

/** Applies the clock: ends a finished warning or ended view, and sets or clears the broken view. */
function settle(state: ClientState, nowMs: number): ClientState {
  if (state.shown.level === "ended") {
    if (state.endedUntilMs !== null && nowMs >= state.endedUntilMs) return { ...state, shown: IDLE, endedUntilMs: null };
    return state;
  }
  if (!live(state)) return state;

  if (brokenStage(nowMs, state.downSinceMs) !== null) {
    // Red is never held back: a red warning runs its full time even over a broken stage.
    if (redShowing(state, nowMs)) return state;
    return state.shown.level === "broken" ? state : { ...state, shown: BROKEN, warningUntilMs: null };
  }
  if (state.shown.level === "broken") return { ...state, shown: LISTENING, warningUntilMs: null };
  if (state.warningUntilMs !== null && nowMs >= state.warningUntilMs) return { ...state, shown: LISTENING, warningUntilMs: null };
  return state;
}

export function reduceClient(state: ClientState, event: ClientEvent): ClientState {
  switch (event.type) {
    case "started":
      return { shown: LISTENING, warningUntilMs: null, endedUntilMs: null, downSinceMs: {} };

    case "tick":
      return settle(state, event.nowMs);

    case "stage_down": {
      if (state.downSinceMs[event.stage] !== undefined) return state;
      return settle({ ...state, downSinceMs: { ...state.downSinceMs, [event.stage]: event.atMs } }, event.atMs);
    }

    case "stage_up": {
      if (state.downSinceMs[event.stage] === undefined) return state;
      const rest = { ...state.downSinceMs };
      delete rest[event.stage];
      const next = { ...state, downSinceMs: rest };
      // A broken view clears as soon as no stage is down for long enough; the clock decides on the next tick or here.
      if (next.shown.level === "broken" && Object.keys(rest).length === 0) return { ...next, shown: LISTENING, warningUntilMs: null };
      return next;
    }

    case "decision": {
      const settled = settle(state, event.atMs);
      if (!live(settled) || event.level === "listening") return settled;
      // While broken only red gets through; it shows for its full time, then broken returns if a stage is still down.
      if (event.level === "amber" && (settled.shown.level === "broken" || redShowing(settled, event.atMs))) return settled;
      return {
        ...settled,
        shown: { level: event.level, text: event.level === "red" ? PILL_TEXT.red : PILL_TEXT.amber },
        warningUntilMs: event.atMs + WARNING_VISIBLE_MS,
      };
    }

    case "ended":
      return {
        shown: { level: "ended", text: endedText(event.hiddenCount) },
        warningUntilMs: null,
        endedUntilMs: event.atMs + ENDED_VISIBLE_MS,
        downSinceMs: {},
      };
  }
}
