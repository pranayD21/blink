/**
 * The thin route layer (§3.2, §14). A route resolves the actor, validates the
 * body with Zod, calls one service function, and maps errors to
 * `{ error: { code, message, details? } }` with the status the service chose.
 *
 * `Idempotency-Key` on a mutation: the first response is stored and returned
 * again for a repeat of the same request by the same user, so a double-click
 * or a retried request cannot apply twice.
 */
import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import type { Actor } from "../auth/actor";
import { requireSessionActor } from "../auth/session";
import { nowIso } from "../clock";
import { getDb } from "../db/client";
import { idempotency } from "../db/schema";
import { AppError, badRequest } from "../errors";
import { LlmError } from "../llm/client";

export interface ApiContext<P> {
  req: NextRequest;
  params: P;
  actor: Actor;
  /** Parses and validates the JSON body. An invalid body is a 400 with the field errors. */
  body<S extends z.ZodType>(schema: S): Promise<z.infer<S>>;
}

/** A handler may return a plain value (sent as 200 JSON) or `reply(status, body)`. */
export interface Reply {
  __reply: true;
  status: number;
  body: unknown;
}
export const reply = (status: number, body: unknown): Reply => ({ __reply: true, status, body });
const isReply = (value: unknown): value is Reply => typeof value === "object" && value !== null && (value as Reply).__reply === true;

export function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) return Response.json(errorBody(err.code, err.message, err.details), { status: err.status });
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    return Response.json(errorBody("VALIDATION", first ? `${first.path ? `${first.path}: ` : ""}${first.message}` : "invalid request", issues), { status: 400 });
  }
  if (err instanceof LlmError) return Response.json(errorBody(err.code, err.message), { status: 502 });
  console.error("[api] unexpected error:", err);
  return Response.json(errorBody("INTERNAL", err instanceof Error ? err.message : "unexpected error"), { status: 500 });
}

interface Stored {
  status: number;
  body: unknown;
}

export function api<P = Record<string, never>>(handler: (ctx: ApiContext<P>) => unknown | Promise<unknown>) {
  return async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      const actor = await requireSessionActor();
      const params = await context.params;

      const key = req.method === "GET" ? null : req.headers.get("idempotency-key");
      const scopedKey = key ? `${actor.id}:${req.method}:${new URL(req.url).pathname}:${key}` : null;
      if (scopedKey) {
        const hit = getDb().select().from(idempotency).where(eq(idempotency.key, scopedKey)).get();
        if (hit) {
          const stored = JSON.parse(hit.responseJson) as Stored;
          return Response.json(stored.body, { status: stored.status, headers: { "Idempotent-Replay": "true" } });
        }
      }

      const result = await handler({
        req,
        params,
        actor,
        async body(schema) {
          let raw: unknown;
          try {
            raw = await req.json();
          } catch {
            throw badRequest("the request body is not valid JSON");
          }
          return schema.parse(raw);
        },
      });
      const out: Stored = isReply(result) ? { status: result.status, body: result.body } : { status: 200, body: result ?? { ok: true } };
      if (scopedKey) {
        getDb().insert(idempotency).values({ key: scopedKey, responseJson: JSON.stringify(out), createdAt: nowIso() }).onConflictDoNothing().run();
      }
      return Response.json(out.body, { status: out.status });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
