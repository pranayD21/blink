/** POST /api/cases/:id/attest — whole-call attestation (reviewer). */
import { transact } from "@/server/db/client";
import { api, reply } from "@/server/http/route";
import { AttestSchema, attestCase } from "@/server/services/attestations";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(AttestSchema);
  return reply(201, transact((tx) => attestCase(tx, params.id, input, actor)));
});
