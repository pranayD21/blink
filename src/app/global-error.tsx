"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/**
 * A crash in the root layout itself (the header, the trial guide). It replaces the whole document,
 * so it carries its own styles. The crash goes to the server log.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => reportClientError(error, "global"), [error]);
  const button = { padding: "0.7rem 1.3rem", borderRadius: 999, border: "1px solid rgba(0,0,0,0.18)", background: "rgba(255,255,255,0.6)", font: "inherit", cursor: "pointer" } as const;
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3efe7", color: "#121210", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
        <main style={{ maxWidth: 520, padding: 24 }}>
          <h1 style={{ fontSize: 30, fontWeight: 400, margin: "0 0 12px" }}>Blink hit a problem.</h1>
          <p style={{ fontSize: 18, opacity: 0.65, margin: "0 0 20px" }}>It was reported. Try again, or reload the page.</p>
          <div style={{ display: "flex", gap: 12 }}>
            <button type="button" style={button} onClick={() => retry()}>
              Try again
            </button>
            <button type="button" style={button} onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
