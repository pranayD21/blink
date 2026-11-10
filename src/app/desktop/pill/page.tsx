"use client";

import { useEffect, useRef, useState } from "react";
import { Pill } from "@/components/live/pill";
import type { PillView } from "@/core/live/client";

const LEVELS = new Set<string>(["idle", "listening", "amber", "red", "broken", "ended"]);

function asView(data: unknown): PillView | null {
  if (typeof data !== "object" || data === null) return null;
  const { level, text } = data as { level?: unknown; text?: unknown };
  if (typeof level !== "string" || !LEVELS.has(level) || typeof text !== "string") return null;
  return { level: level as PillView["level"], text };
}

/** The pill window of the banker's app: renders the latest PillView it is sent, on a transparent background. */
export default function PillPage() {
  const [view, setView] = useState<PillView>({ level: "idle", text: "" });
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const channel = new BroadcastChannel("blink-pill");
    channel.onmessage = (event: MessageEvent) => {
      const next = asView(event.data);
      if (next) setView(next);
    };
    // A marker for tests: set only once the listener is attached, so nothing sent earlier is lost unseen.
    root.current?.setAttribute("data-ready", "true");
    return () => channel.close();
  }, []);

  return (
    <main ref={root} className="flex flex-1 items-center justify-center p-2">
      {/* The window shows only the pill, so the page and body paint nothing. */}
      <style>{"html, body { background: transparent !important; }"}</style>
      <Pill view={view} />
    </main>
  );
}
