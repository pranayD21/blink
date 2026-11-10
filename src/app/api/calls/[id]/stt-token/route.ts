/** POST /api/calls/:id/stt-token — a 30-second speech-to-text token, never the key. */
import { api } from "@/server/http/route";
import { z } from "zod";
import { mintSttToken } from "@/server/services/live";

const TokenSchema = z.strictObject({});

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  await body(TokenSchema);
  return mintSttToken(params.id, actor);
});
