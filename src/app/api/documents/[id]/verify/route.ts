/** POST /api/documents/:id/verify — the "verify" toggle on one extracted fact (reviewer). */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { VerifyFactSchema, setFactVerified } from "@/server/services/documents";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(VerifyFactSchema);
  return transact((tx) => setFactVerified(tx, params.id, input, actor));
});
