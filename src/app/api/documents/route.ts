/** GET /api/documents — curated documents with their extracted facts (reviewer). */
import { requireReviewer } from "@/server/auth/actor";
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { listDocuments } from "@/server/services/documents";

export const GET = api(({ actor }) => {
  requireReviewer(actor);
  return { documents: listDocuments(getDb()) };
});
