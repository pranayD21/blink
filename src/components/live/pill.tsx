import { StatusDot, type DotTone } from "@/components/app/status-dot";
import type { PillView } from "@/core/live/client";

const TONE: Record<Exclude<PillView["level"], "idle">, DotTone> = {
  listening: "good",
  amber: "warn",
  red: "stop",
  broken: "ring",
  ended: "good",
};

/** One rounded line: a dot and the words. Nothing to click, nothing else on screen. Idle shows nothing at all. */
export function Pill({ view }: { view: PillView }) {
  if (view.level === "idle") return null;
  return (
    <div
      data-testid="pill"
      data-level={view.level}
      role="status"
      className="rounded-full border border-border bg-popover px-4 py-2 text-sm text-popover-foreground"
    >
      <StatusDot tone={TONE[view.level]} className="whitespace-normal">
        {view.text}
      </StatusDot>
    </div>
  );
}
