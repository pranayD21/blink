/** POST /api/policies/:versionId/approve — the owner approves the exact bundle hash → ACTIVE. */
import { z } from "zod";
import { transact } from "@/server/db/client";
import { api } from "@/server/http/route";
import { approvePolicy } from "@/server/services/policies";

const Schema = z.strictObject({ bundleHash: z.string().min(8) });

export const POST = api<{ versionId: string }>(async ({ params, actor, body }) => {
  const { bundleHash } = await body(Schema);
  return transact((tx) => approvePolicy(tx, params.versionId, bundleHash, actor));
});
