/**
 * Status is a small dot beside plain words (see status-dot.tsx); there is no badge.
 * What is left here is the state label and the transcript highlight tints.
 */
import { cn } from "@/lib/utils";
import { type DotTone, StateLabel, dotOf } from "./status-dot";

/** The tone a state reads as, for tints that follow a finding's state. */
export function toneOf(state: string): DotTone {
  return dotOf(state);
}

/** A state in plain words with a dot ("Review required"). The raw state stays in data-state. */
export function StateChip({ state, className, ...rest }: { state: string } & Omit<React.ComponentProps<"span">, "children">) {
  return <StateLabel {...rest} state={state} className={cn("text-xs", className)} />;
}

/** Soft background for transcript highlights, keyed by finding state. */
export const HIGHLIGHT: Record<DotTone, string> = {
  warn: "bg-warning/15 decoration-warning hover:bg-warning/25",
  stop: "bg-destructive/15 decoration-destructive hover:bg-destructive/25",
  good: "bg-success/15 decoration-success hover:bg-success/25",
  none: "bg-muted decoration-border hover:bg-muted",
  ring: "bg-muted decoration-muted-foreground hover:bg-muted",
};
