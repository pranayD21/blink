/** What the pill shows, decided from what the monitors did on one turn and what the last question asked. Pure. */

export const PILL_TEXT = {
  listening: "Listening",
  amber: "Getting close to inside information. Steer away.",
  red: "Sounds like inside information. Move on.",
  broken: "Blink can't hear the call.",
} as const;

export const WARNING_VISIBLE_MS = 6000;
export const AMBER_MIN_GAP_MS = 30000;
export const BROKEN_AFTER_MS = 3000;

export function endedText(hiddenCount: number): string {
  if (hiddenCount <= 0) return "Call ended. Nothing was hidden.";
  return `Call ended. ${hiddenCount} ${hiddenCount === 1 ? "passage" : "passages"} hidden and sent to compliance.`;
}

export type PillLevel = "listening" | "amber" | "red";

export interface MonitorMove {
  claimKey: string;
  ruleId: string;
  prevState: string;
  nextState: string;
  addedQuoteThisTurn: boolean;
}

export interface PillInput {
  moves: readonly MonitorMove[];
  probeRuleIds: readonly string[];
  msSinceLastAmber: number | null;
}

export interface PillDecision {
  level: PillLevel;
  reason: "rule_met" | "question_asks_for_restricted" | "still_one_fact_short" | "none";
  ruleIds: string[];
  suppressed: boolean;
}

const REVIEW_STATES: ReadonlySet<string> = new Set(["REVIEW_REQUIRED", "ESCALATION_REQUESTED"]);

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

export function decidePill(input: PillInput): PillDecision {
  const entered = input.moves.filter((m) => REVIEW_STATES.has(m.nextState) && m.prevState !== m.nextState);
  if (entered.length > 0) {
    return { level: "red", reason: "rule_met", ruleIds: unique(entered.map((m) => m.ruleId)), suppressed: false };
  }

  let reason: PillDecision["reason"] = "none";
  let ruleIds: string[] = [];
  if (input.probeRuleIds.length > 0) {
    reason = "question_asks_for_restricted";
    ruleIds = unique(input.probeRuleIds);
  } else {
    const short = input.moves.filter((m) => m.prevState === "NEEDS_CONTEXT" && m.nextState === "NEEDS_CONTEXT" && m.addedQuoteThisTurn);
    if (short.length > 0) {
      reason = "still_one_fact_short";
      ruleIds = unique(short.map((m) => m.ruleId));
    }
  }
  if (reason === "none") return { level: "listening", reason, ruleIds, suppressed: false };

  if (input.msSinceLastAmber !== null && input.msSinceLastAmber < AMBER_MIN_GAP_MS) {
    return { level: "listening", reason, ruleIds, suppressed: true };
  }
  return { level: "amber", reason, ruleIds, suppressed: false };
}
