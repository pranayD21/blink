/** GET /api/analyst/briefs — released briefs only, with the quotes behind each citation. */
import { getDb } from "@/server/db/client";
import { api } from "@/server/http/route";
import { releasedBriefs } from "@/server/services/briefs";

export const GET = api(({ actor }) => ({ briefs: releasedBriefs(getDb(), actor) }));
