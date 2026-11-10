"use client";

import { useState } from "react";
import { type DotTone, StatusDot } from "@/components/app/status-dot";
import { cn } from "@/lib/utils";
import type { MomentView, StepView } from "@/server/services/observability";
import { TimeBar, formatSpan } from "./time-bar";

/** A moment with its clock label ("02:41") worked out on the server. */
export type MomentRow = MomentView & { at: string };

const TONE: Record<MomentView["level"], DotTone> = { listening: "none", amber: "warn", red: "stop", broken: "ring" };
const LEVEL_WORDS: Record<MomentView["level"], string> = { listening: "Quiet", amber: "Amber warning", red: "Red warning", broken: "Problem" };

const keyOf = (m: MomentRow, i: number) => (m.kind === "turn" ? `moment-${m.seq}` : `moment-outage-${i}`);

/**
 * One line per moment, in order: when, a dot for what the banker saw, what was said and what Blink
 * concluded, and the time from the end of the speech to the screen. A turn opens into its steps.
 */
export function MomentList({ moments }: { moments: MomentRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (moments.length === 0) return <p className="border-t py-4 text-sm text-muted-foreground">Nothing was heard on this call.</p>;
  return (
    <div data-testid="moments">
      {moments.map((m, i) => {
        const key = keyOf(m, i);
        const isOpen = open === key;
        const line = (
          <>
            <span className="pt-0.5 font-mono text-[11px] text-muted-foreground">{m.at}</span>
            <StatusDot tone={TONE[m.level]} className="mt-[5px]" />
            <span className="min-w-0">
              <span className="sr-only">{LEVEL_WORDS[m.level]}. </span>
              <span className={cn("block font-medium text-foreground", !isOpen && "line-clamp-2")}>{m.kind === "turn" ? `${m.speaker}: “${m.text}”` : m.text}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{m.conclusion}</span>
            </span>
            <span className="pt-0.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{m.totalMs === null ? "" : formatSpan(m.totalMs)}</span>
          </>
        );
        const grid = "grid w-full grid-cols-[44px_10px_minmax(0,1fr)_52px] items-start gap-2.5 py-2.5 text-left text-[13px]";
        if (m.steps.length === 0) {
          return (
            <div key={key} data-testid={key} data-level={m.level} className={cn(grid, "border-t")}>
              {line}
            </div>
          );
        }
        return (
          <div key={key} className={cn("border-t", isOpen && "-mx-4 bg-secondary px-4 pb-3")}>
            <button type="button" data-testid={key} data-level={m.level} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : key)} className={cn(grid, "cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring")}>
              {line}
            </button>
            {isOpen && <MomentSteps moment={m} />}
          </div>
        );
      })}
    </div>
  );
}

/** The rules step lists each rule in turn; one line per rule reads far better than one paragraph. */
const detailLines = (detail: string) => detail.split(/\s(?=Rule \S+\. )/);

const by = (s: StepView) => (s.meta === null ? null : s.decidedBy === "model" ? `By a model: ${s.meta}` : s.meta);

/** One moment, opened: each step with what came in and out, who or what decided, and when it ran. */
export function MomentSteps({ moment }: { moment: MomentRow }) {
  const domain = Math.max(moment.totalMs ?? 0, ...moment.steps.map((s) => (s.offsetMs ?? 0) + (s.durationMs ?? 0)));
  const shownWhat = moment.level === "amber" || moment.level === "red" ? "warning" : "pill";
  const speaker = (moment.speaker ?? "speaker").toLowerCase();
  return (
    <div className="mt-1 rounded-lg border bg-card p-4" data-testid="moment-steps">
      <p className="mb-3 text-[13px] font-semibold text-foreground">{shownWhat === "warning" ? `Why the warning at ${moment.at} appeared` : `What happened at ${moment.at}`}</p>
      {moment.steps.map((s, i) => (
        <div key={s.name} data-testid={`step-${s.name}`} className={cn("grid grid-cols-[104px_minmax(0,1fr)_140px_48px] items-start gap-3 py-2.5 text-[13px]", i > 0 && "border-t")}>
          <span className="font-semibold text-foreground">{s.name}</span>
          <span className="text-foreground">
            {s.name === "Rules checked" ? detailLines(s.detail).map((line, j) => <span key={j} className="block [&+&]:mt-1">{line}</span>) : s.detail}
            {by(s) && <span className="mt-0.5 block text-[11.5px] text-muted-foreground">{by(s)}</span>}
          </span>
          <TimeBar offsetMs={s.offsetMs} durationMs={s.durationMs} domainMs={domain} />
          <span className="pt-0.5 text-right font-mono text-[11px] text-muted-foreground tabular-nums">{s.durationMs === null ? "" : formatSpan(s.durationMs)}</span>
        </div>
      ))}
      <p className="mt-2 border-t pt-3 text-xs text-muted-foreground" data-testid="moment-total">
        {moment.totalMs === null ? (
          "The app never confirmed this turn reached the screen, so it has no time from speech to screen."
        ) : (
          <>
            <span className="font-semibold text-foreground">{formatSpan(moment.totalMs)}</span> from the end of the {speaker}&apos;s sentence to the {shownWhat} on screen.
          </>
        )}
      </p>
    </div>
  );
}
