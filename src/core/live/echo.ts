/** Detects the microphone picking up the far side's voice from the speakers. Pure. */

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);

/** True when the microphone text has at least three words and at least 80% of them occur in the other text. */
export function isEchoOf(micText: string, otherText: string): boolean {
  const mic = words(micText);
  if (mic.length < 3) return false;
  const other = new Set(words(otherText));
  const shared = mic.filter((w) => other.has(w)).length;
  return shared / mic.length >= 0.8;
}
