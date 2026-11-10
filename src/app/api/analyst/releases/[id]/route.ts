/** GET /api/analyst/releases/:id — the released transcript with hidden passages blanked; 404 if the caller may not read it. */
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { releasedTranscript } from "@/server/services/released";

export const GET = api<{ id: string }>(({ params, actor }) => releasedTranscript(getDb(), params.id, actor));
