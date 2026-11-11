/** Sends a browser crash to the server log through POST /api/client-errors. Never throws. */
export function reportClientError(error: unknown, boundary: "segment" | "global"): void {
  try {
    const e = error instanceof Error ? error : null;
    const body = JSON.stringify({
      boundary,
      path: window.location.pathname,
      name: e?.name ?? typeof error,
      message: e?.message ?? String(error),
      digest: e && "digest" in e && typeof e.digest === "string" ? e.digest : undefined,
      stack: e?.stack?.split("\n").slice(0, 6).join("\n"),
    }).slice(0, 4000);
    const blob = new Blob([body], { type: "application/json" });
    if (!navigator.sendBeacon?.("/api/client-errors", blob)) {
      void fetch("/api/client-errors", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
    }
  } catch {
    // Reporting must never be the second crash.
  }
}
