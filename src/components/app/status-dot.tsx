import { cn } from "@/lib/utils";
import { humanize } from "@/lib/format";

export type DotTone = "good" | "warn" | "stop" | "none" | "ring";

const DOT: Record<DotTone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  stop: "bg-destructive",
  none: "bg-muted-foreground/45",
  ring: "border-[1.5px] border-muted-foreground bg-transparent",
};

/** A small dot beside plain words. Colour carries the status; the words always say it too. */
export function StatusDot({ tone, className, children, ...rest }: { tone: DotTone } & React.ComponentProps<"span">) {
  return (
    <span {...rest} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}

const STATE_DOT: Record<string, DotTone> = {
  // findings and monitors
  NEEDS_CONTEXT: "warn",
  REVIEW_REQUIRED: "stop",
  ESCALATION_REQUESTED: "ring",
  ESCALATED: "ring",
  DISPOSITIONED: "good",
  NOT_TRIGGERED: "none",
  NOT_TRIGGERED_PENDING_ACK: "none",
  UNASSESSED: "none",
  REOPENED: "stop",
  // cases
  INTAKE: "none",
  ANALYZING: "ring",
  ANALYSIS_FAILED: "stop",
  IN_REVIEW: "warn",
  READY_FOR_APPROVAL: "ring",
  APPROVED: "good",
  RELEASED: "good",
  STALE: "stop",
  // policy versions
  DRAFT: "none",
  COMPILING: "ring",
  COMPILE_FAILED: "stop",
  VALIDATED: "ring",
  ACTIVE: "good",
  SUPERSEDED: "none",
  // briefs
  draft: "none",
  approved: "ring",
  released: "good",
  stale: "stop",
};

export function dotOf(state: string): DotTone {
  return STATE_DOT[state] ?? "none";
}

/** A state in the machine's vocabulary shown as a dot and plain words ("Review required"). The raw state stays in data-state. */
export function StateLabel({ state, className, ...rest }: { state: string } & Omit<React.ComponentProps<"span">, "children">) {
  return (
    <StatusDot {...rest} tone={dotOf(state)} className={className} data-state={state}>
      {humanize(state)}
    </StatusDot>
  );
}
