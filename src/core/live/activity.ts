/**
 * One sentence for the live trace: what the agent did with a turn, without the words that were said.
 * The pill stays the banker's only message. This line is for the person watching the call run.
 */
import type { PillLevel } from "./pill";

export interface ActivityInput {
  readStatus: "read" | "timeout" | "refused" | "error";
  level: PillLevel;
  reason: string;
  suppressed: boolean;
}

export function activityLine(input: ActivityInput): string {
  if (input.readStatus === "timeout") return "The read ran out of time. This turn will be read after the call.";
  if (input.readStatus !== "read") return "The reader stopped on this turn. The after-call read will cover it.";
  if (input.level === "red") return "A rule is met. Move on.";
  if (input.reason === "question_asks_for_restricted" && input.level === "amber") return "The question asks for something a rule restricts.";
  if (input.reason === "question_asks_for_restricted" && input.suppressed) return "The question is close to a rule. A warning was just shown, so this one stays quiet.";
  if (input.reason === "still_one_fact_short" && input.level === "amber") return "One fact short of a rule, and the conversation stayed there.";
  if (input.reason === "still_one_fact_short") return "One fact is still missing. Watching.";
  return "Checked against the policy. No rule applies.";
}
