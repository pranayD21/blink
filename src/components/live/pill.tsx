import { cn } from "@/lib/utils";
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
      className={cn(
        "rounded-full border border-border bg-popover py-[7px] pr-3.5 pl-3 text-[12.5px] whitespace-nowrap text-popover-foreground",
        view.level === "listening" ? "font-normal text-muted-foreground" : "font-medium shadow-[0_6px_18px_rgba(0,0,0,0.16)]",
      )}
    >
      <StatusDot tone={TONE[view.level]} className="gap-2">
        {view.text}
      </StatusDot>
    </div>
  );
}
