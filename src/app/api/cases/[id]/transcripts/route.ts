/** POST /api/cases/:id/transcripts — upload a transcript version (JSON or multipart) and enqueue analysis. */
import { transact } from "@/server/db/client";
import { badRequest, forbidden } from "@/server/errors";
import { api, reply } from "@/server/http/route";
import { UploadTranscriptSchema, uploadTranscript } from "@/server/services/transcripts";

/** Hand-labeled claims are a development aid; a production build refuses them unless explicitly allowed. */
const goldAllowed = () => process.env.NODE_ENV !== "production" || process.env.BLINK_ALLOW_GOLD === "1";

export const POST = api<{ id: string }>(async ({ req, params, actor, body }) => {
  let input;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("attach the transcript as the `file` field");
    const speakerMap = form.get("speakerMap");
    let parsedMap: unknown;
    try {
      parsedMap = typeof speakerMap === "string" && speakerMap ? JSON.parse(speakerMap) : undefined;
    } catch {
      throw badRequest("speakerMap is not valid JSON");
    }
    input = UploadTranscriptSchema.parse({
      text: await file.text(),
      filename: file.name,
      sourceLabel: typeof form.get("sourceLabel") === "string" && form.get("sourceLabel") ? form.get("sourceLabel") : undefined,
      speakerMap: parsedMap,
      source: typeof form.get("source") === "string" ? form.get("source") : undefined,
    });
  } else {
    input = await body(UploadTranscriptSchema);
  }
  if (input.source === "gold" && !goldAllowed()) throw forbidden("hand-labeled claims can only be loaded in development");
  return reply(201, transact((tx) => uploadTranscript(tx, params.id, input, actor)));
});
