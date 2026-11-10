/** The live call as plain transcript text, so the same parser reads it as reads an uploaded file. Pure. */

export interface LiveTurn {
  seq: number;
  speaker: "analyst" | "expert";
  text: string;
  speechStartMs: number | null;
  speechEndMs: number;
}

const pad = (n: number): string => String(n).padStart(2, "0");

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** One line per turn: `[HH:MM:SS] Analyst (<name>): <text>`, timed from the start of speech when known. */
export function liveTranscriptText(turns: readonly LiveTurn[], names: { analyst: string; expert: string }): string {
  return turns
    .map((t) => {
      const label = t.speaker === "analyst" ? "Analyst" : "Expert";
      const text = t.text.replace(/\s*[\r\n]+\s*/g, " ").trim();
      return `[${clock(t.speechStartMs ?? t.speechEndMs)}] ${label} (${names[t.speaker]}): ${text}`;
    })
    .join("\n");
}
