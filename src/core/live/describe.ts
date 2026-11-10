/** One plain sentence saying what Blink did with a moment on the call, for the record. Pure. */
import { type PillDecision, PILL_TEXT, AMBER_MIN_GAP_MS } from "./pill";

export interface MomentFacts {
  readStatus: "read" | "timeout" | "refused" | "error";
  claimCount: number;
  decision: PillDecision;
  linkedLabels: string[];
  firstUnknown: string | null;
}

export function describeMoment(m: MomentFacts): string {
  if (m.readStatus !== "read") return `Not read live (${m.readStatus}). Covered by the after-call read. Nothing shown.`;

  const { decision } = m;
  const rules = decision.ruleIds.join(", ");
  const shown = (text: string) => `Showed “${text}”`;

  if (decision.level === "red") {
    const links = m.linkedLabels.length > 0 ? `, linking back to ${m.linkedLabels.join(", ")}` : "";
    return `Rule ${rules} is met${links}. ${shown(PILL_TEXT.red)}`;
  }

  const ambersAbout =
    decision.reason === "question_asks_for_restricted"
      ? `The question asks for something rule ${rules} restricts.`
      : decision.reason === "still_one_fact_short"
        ? `Still one fact short of rule ${rules}, and the conversation stayed on it.`
        : null;

  if (ambersAbout !== null) {
    if (decision.level === "amber") return `${ambersAbout} ${shown(PILL_TEXT.amber)}`;
    if (decision.suppressed) return `${ambersAbout} Not shown: a warning was shown less than ${AMBER_MIN_GAP_MS / 1000} seconds earlier.`;
  }

  if (m.claimCount === 0) return "Nothing to check. Nothing shown.";
  if (m.firstUnknown !== null) return `One fact short of a rule: ${m.firstUnknown}. Watching. Nothing shown.`;
  return "Checked against the policy. No rule applies. Nothing shown.";
}
