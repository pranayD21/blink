/** Which stage of the live pipeline, if any, has been down long enough that the pill must say so. Pure. */
import { BROKEN_AFTER_MS } from "./pill";

export const STAGES = ["hearing", "transcribing", "reading", "rules", "screen"] as const;
export type Stage = (typeof STAGES)[number];

/** The first stage, in STAGES order, that has been down for more than BROKEN_AFTER_MS. */
export function brokenStage(nowMs: number, downSinceMs: Partial<Record<Stage, number>>): Stage | null {
  for (const stage of STAGES) {
    const since = downSinceMs[stage];
    if (since !== undefined && nowMs - since > BROKEN_AFTER_MS) return stage;
  }
  return null;
}
