/**
 * Status colors (§15): amber = needs context, red = review required,
 * violet = escalated, emerald = dispositioned, slate = not triggered.
 */
import { cn } from "@/lib/utils";

type Tone = "amber" | "red" | "violet" | "emerald" | "slate" | "indigo" | "sky";

const TONE: Record<Tone, string> = {
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  slate: "bg-slate-100 text-slate-600 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
};

const STATE_TONE: Record<string, Tone> = {
  // findings and monitors
  NEEDS_CONTEXT: "amber",
  REVIEW_REQUIRED: "red",
  ESCALATION_REQUESTED: "violet",
  ESCALATED: "violet",
  DISPOSITIONED: "emerald",
  NOT_TRIGGERED: "slate",
  NOT_TRIGGERED_PENDING_ACK: "slate",
  UNASSESSED: "slate",
  REOPENED: "red",
  // cases
  INTAKE: "slate",
  ANALYZING: "sky",
  ANALYSIS_FAILED: "red",
  IN_REVIEW: "amber",
  READY_FOR_APPROVAL: "indigo",
  APPROVED: "emerald",
  RELEASED: "emerald",
  STALE: "red",
  // policy versions
  DRAFT: "slate",
  COMPILING: "sky",
  COMPILE_FAILED: "red",
  VALIDATED: "indigo",
  ACTIVE: "emerald",
  SUPERSEDED: "slate",
  // briefs
  draft: "slate",
  approved: "indigo",
  released: "emerald",
  stale: "red",
};

export function toneOf(state: string): Tone {
  return STATE_TONE[state] ?? "slate";
}

export function Chip({ tone = "slate", className, children, ...rest }: { tone?: Tone } & React.ComponentProps<"span">) {
  return (
    <span {...rest} className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TONE[tone], className)}>
      {children}
    </span>
  );
}

/** A state in the machine's own vocabulary (REVIEW_REQUIRED), colored by meaning. */
export function StateChip({ state, className, ...rest }: { state: string } & Omit<React.ComponentProps<"span">, "children">) {
  return (
    <Chip {...rest} tone={toneOf(state)} className={cn("font-mono tracking-tight", className)} data-state={state}>
      {state}
    </Chip>
  );
}

/** Soft background for transcript highlights, keyed by finding state. */
export const HIGHLIGHT: Record<Tone, string> = {
  amber: "bg-amber-100/80 decoration-amber-400 hover:bg-amber-200/80",
  red: "bg-red-100/80 decoration-red-400 hover:bg-red-200/80",
  violet: "bg-violet-100/80 decoration-violet-400 hover:bg-violet-200/80",
  emerald: "bg-emerald-100/70 decoration-emerald-400 hover:bg-emerald-200/70",
  slate: "bg-slate-100 decoration-slate-300 hover:bg-slate-200/80",
  indigo: "bg-indigo-100/70 decoration-indigo-400 hover:bg-indigo-200/70",
  sky: "bg-sky-100/70 decoration-sky-400 hover:bg-sky-200/70",
};
