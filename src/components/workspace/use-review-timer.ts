"use client";

import { useEffect, useRef } from "react";
import { api } from "@/lib/api";

const BEAT_MS = 20_000;

/**
 * Review-session timing (§16 Phase 7): a heartbeat while the reviewer is
 * active on the page. The server pauses the clock after two minutes without
 * one, so an open tab left alone does not count as review time.
 */
export function useReviewTimer(caseId: string, mode: "blink" | "baseline", enabled = true) {
  const active = useRef(true);
  useEffect(() => {
    if (!enabled) return;
    const mark = () => {
      active.current = true;
    };
    const events = ["mousemove", "keydown", "scroll", "click"] as const;
    for (const e of events) window.addEventListener(e, mark, { passive: true, capture: true });
    const beat = () => {
      if (!active.current || document.hidden) return;
      active.current = false;
      api(`/api/cases/${caseId}/session`, { body: { mode } }).catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, BEAT_MS);
    return () => {
      clearInterval(timer);
      for (const e of events) window.removeEventListener(e, mark, { capture: true });
    };
  }, [caseId, mode, enabled]);
}
