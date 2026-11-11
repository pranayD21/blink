/**
 * POST /api/client-errors — a page that crashed in the browser says so here, and the server writes
 * one line to its log (`[client-error] …`). Without it, a crash in a visitor's browser leaves no
 * trace anywhere the team can read. Open to any caller, because a crash can happen before sign-in.
 * It is same-origin only, reads at most 4 KB, stores nothing and answers 204 with no body.
 */
import { requireSameOrigin } from "@/server/http/route";
import { clientErrorLine } from "@/server/http/client-error";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4096;

export async function POST(req: Request): Promise<Response> {
  try {
    requireSameOrigin(req);
  } catch {
    return new Response(null, { status: 403 });
  }
  const text = await req.text();
  if (text.length > MAX_BYTES) return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const line = clientErrorLine(body, req.headers.get("user-agent"));
  if (!line) return new Response(null, { status: 400 });
  console.error(line);
  return new Response(null, { status: 204 });
}
