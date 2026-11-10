/** POST /api/transcripts/preview — parse without storing, for the speaker-mapping preview. */
import { z } from "zod";
import { api } from "@/server/http/route";
import { previewTranscript } from "@/server/services/transcripts";

const Schema = z.strictObject({
  text: z.string().min(1, "the transcript is empty"),
  filename: z.string().nullable().optional(),
  speakerMap: z.record(z.string(), z.enum(["analyst", "expert", "moderator"])).optional(),
});

export const POST = api(async ({ body }) => {
  const input = await body(Schema);
  const parsed = previewTranscript(input.text, input.filename, input.speakerMap);
  return {
    format: parsed.format,
    turnCount: parsed.turns.length,
    unknownSpeakers: parsed.unknownSpeakers,
    speakers: [...new Map(parsed.turns.map((t) => [t.speakerName, t.speaker])).entries()].map(([name, role]) => ({ name, role })),
    turns: parsed.turns.slice(0, 8).map((t) => ({ label: t.label, speaker: t.speaker, speakerName: t.speakerName, text: t.text })),
  };
});
