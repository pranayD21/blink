/**
 * Status is a small dot beside plain words (see status-dot.tsx). Chip is a quiet
 * muted tag for everything else; only the three status tones carry colour.
 */
import { cn } from "@/lib/utils";
import { type DotTone, StateLabel, dotOf } from "./status-dot";

/** `warn | stop | good | none | ring` is the vocabulary; the colour names below are old aliases kept until the screens that still use them are restyled. */
type Tone = "warn" | "stop" | "good" | "none" | "ring" | "amber" | "red" | "violet" | "emerald" | "slate" | "indigo" | "sky";

const QUIET = "bg-muted text-muted-foreground";
const TONE: Record<Tone, string> = {
  warn: "bg-warning/15 text-foreground",
  stop: "bg-destructive/15 text-foreground",
  good: "bg-success/15 text-foreground",
  none: QUIET,
  ring: QUIET,
  amber: "bg-warning/15 text-foreground",
  red: "bg-destructive/15 text-foreground",
  emerald: "bg-success/15 text-foreground",
  violet: QUIET,
  slate: QUIET,
  indigo: QUIET,
  sky: QUIET,
};

/** The tone a state reads as, for tints that follow a finding's state. */
export function toneOf(state: string): DotTone {
  return dotOf(state);
}

export function Chip({ tone = "none", className, children, ...rest }: { tone?: Tone } & React.ComponentProps<"span">) {
  return (
    <span {...rest} className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

/** A state in plain words with a dot ("Review required"). The raw state stays in data-state. */
export function StateChip({ state, className, ...rest }: { state: string } & Omit<React.ComponentProps<"span">, "children">) {
  return <StateLabel {...rest} state={state} className={cn("text-xs", className)} />;
}

/** Soft background for transcript highlights, keyed by finding state. */
export const HIGHLIGHT: Record<Tone, string> = {
  warn: "bg-warning/15 decoration-warning hover:bg-warning/25",
  stop: "bg-destructive/15 decoration-destructive hover:bg-destructive/25",
  good: "bg-success/15 decoration-success hover:bg-success/25",
  none: "bg-muted decoration-border hover:bg-muted",
  ring: "bg-muted decoration-muted-foreground hover:bg-muted",
  amber: "bg-warning/15 decoration-warning hover:bg-warning/25",
  red: "bg-destructive/15 decoration-destructive hover:bg-destructive/25",
  emerald: "bg-success/15 decoration-success hover:bg-success/25",
  violet: "bg-muted decoration-muted-foreground hover:bg-muted",
  slate: "bg-muted decoration-border hover:bg-muted",
  indigo: "bg-muted decoration-muted-foreground hover:bg-muted",
  sky: "bg-muted decoration-muted-foreground hover:bg-muted",
};
