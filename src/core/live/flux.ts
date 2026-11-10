/** Parses one Deepgram Flux (v2/listen) message into the few events the turn assembler needs. Pure. */

export type FluxEvent =
  | { kind: "update"; turnIndex: number; transcript: string }
  | { kind: "eager_end" | "end"; turnIndex: number; transcript: string; audioStartMs: number; audioEndMs: number }
  | { kind: "start" | "resumed"; turnIndex: number }
  | { kind: "other" };

const OTHER: FluxEvent = { kind: "other" };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseFluxMessage(raw: string): FluxEvent {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return OTHER;
  }
  if (typeof msg !== "object" || msg === null) return OTHER;
  const m = msg as Record<string, unknown>;
  if (m.type !== "TurnInfo" || !isNum(m.turn_index)) return OTHER;
  const turnIndex = m.turn_index;
  const transcript = typeof m.transcript === "string" ? m.transcript : "";

  switch (m.event) {
    case "Update":
      return { kind: "update", turnIndex, transcript };
    case "StartOfTurn":
      return { kind: "start", turnIndex };
    case "TurnResumed":
      return { kind: "resumed", turnIndex };
    case "EagerEndOfTurn":
    case "EndOfTurn": {
      if (!isNum(m.audio_window_start) || !isNum(m.audio_window_end)) return OTHER;
      return {
        kind: m.event === "EndOfTurn" ? "end" : "eager_end",
        turnIndex,
        transcript,
        audioStartMs: Math.round(m.audio_window_start * 1000),
        audioEndMs: Math.round(m.audio_window_end * 1000),
      };
    }
    default:
      return OTHER;
  }
}
