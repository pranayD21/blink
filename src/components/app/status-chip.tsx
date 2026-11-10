/**
 * Status is a small dot beside plain words (see status-dot.tsx). Chip is a quiet
 * muted tag for everything else; only the three status tones carry colour.
 */
import { cn } from "@/lib/utils";
import { StateLabel, dotOf } from "./status-dot";

type Tone = "amber" | "red" | "violet" | "emerald" | "slate" | "indigo" | "sky";

const TONE: Record<Tone, string> = {
  amber: "bg-warning/15 text-foreground",
  red: "bg-destructive/15 text-foreground",
  violet: "bg-muted text-muted-foreground",
  emerald: "bg-success/15 text-foreground",
  slate: "bg-muted text-muted-foreground",
  indigo: "bg-muted text-muted-foreground",
  sky: "bg-muted text-muted-foreground",
};

const DOT_TONE = { good: "emerald", warn: "amber", stop: "red", none: "slate", ring: "slate" } as const;

/** The tone a state reads as, for tints that follow a finding's state. */
export function toneOf(state: string): Tone {
  return DOT_TONE[dotOf(state)];
}

export function Chip({ tone = "slate", className, children, ...rest }: { tone?: Tone } & React.ComponentProps<"span">) {
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
  amber: "bg-warning/15 decoration-warning hover:bg-warning/25",
  red: "bg-destructive/15 decoration-destructive hover:bg-destructive/25",
  violet: "bg-muted decoration-muted-foreground hover:bg-muted",
  emerald: "bg-success/15 decoration-success hover:bg-success/25",
  slate: "bg-muted decoration-border hover:bg-muted",
  indigo: "bg-muted decoration-muted-foreground hover:bg-muted",
  sky: "bg-muted decoration-muted-foreground hover:bg-muted",
};
