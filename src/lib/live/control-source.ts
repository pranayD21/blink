/** Which turn source the control page uses. Pure: the server passes in whether scripted calls are allowed. */

export type ControlSource = { kind: "live" } | { kind: "script"; paceMs: number };

export const DEFAULT_PACE_MS = 1500;

type Param = string | string[] | undefined;

const first = (raw: Param) => (Array.isArray(raw) ? raw[0] : raw);

/** `?pace=` for the scripted call, held to something a person or a test can follow. */
export function paceOf(raw: Param): number {
  const n = Number(first(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.max(Math.round(n), 50), 10_000) : DEFAULT_PACE_MS;
}

/** The scripted call only with `?source=script` where scripted calls are allowed; the microphone otherwise. */
export function controlSourceOf(params: { source?: Param; pace?: Param }, scriptedAllowed: boolean): ControlSource {
  return first(params.source) === "script" && scriptedAllowed ? { kind: "script", paceMs: paceOf(params.pace) } : { kind: "live" };
}
