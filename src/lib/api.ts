/**
 * Browser-side calls to the API. Every mutation carries an Idempotency-Key, so
 * a double-click or a retried request cannot apply twice.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Options {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Multipart upload; `body` is ignored. */
  form?: FormData;
  /** Aborting it fails the request as a network error. */
  signal?: AbortSignal;
}

export async function api<T = unknown>(path: string, options: Options = {}): Promise<T> {
  const method = options.method ?? (options.body !== undefined || options.form ? "POST" : "GET");
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["Idempotency-Key"] = crypto.randomUUID();
  if (!options.form && method !== "GET") headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: options.form ?? (method === "GET" ? undefined : JSON.stringify(options.body ?? {})), cache: "no-store", signal: options.signal });
  } catch {
    throw new ApiError(0, "NETWORK", "Could not reach the Blink server. Is it still running?");
  }
  const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string; details?: unknown } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, json?.error?.code ?? "HTTP_ERROR", json?.error?.message ?? `The request failed (${res.status}).`, json?.error?.details);
  }
  return json as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : "Something went wrong.");
