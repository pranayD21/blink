/** POST /api/claims/:id/public-match — a reviewer verifies or rejects a public source for a claim. */
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { PublicMatchReviewSchema, reviewPublicMatch } from "@/server/services/claims";

export const POST = api<{ id: string }>(async ({ params, actor, body }) => {
  const input = await body(PublicMatchReviewSchema);
  return transact((tx) => reviewPublicMatch(tx, params.id, input, actor));
});
