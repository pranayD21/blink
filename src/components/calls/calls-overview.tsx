import Link from "next/link";
import { StatusDot } from "@/components/app/status-dot";
import type { Stage } from "@/core/live/health";
import { type CallsOverview, type StageView, dollars } from "@/server/services/observability";
import { formatDateTime } from "@/lib/format";
import { speedFormatter } from "./time-bar";

const STAGE_LABEL: Record<Stage, string> = { hearing: "Hearing", transcribing: "Transcribing", reading: "Reading", rules: "Rules", screen: "Screen" };

/** Each stage of the live path as a dot and its name, with what went wrong beside a stage that went down. */
export function StageRow({ stages, working = false }: { stages: StageView[]; working?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs" data-testid="stage-row">
      {stages.map((s) => (
        <span key={s.stage} data-testid={`stage-${s.stage}`} data-ok={s.ok}>
          <StatusDot tone={s.ok ? "good" : "warn"}>
            <span className="text-foreground">{STAGE_LABEL[s.stage]}</span>
            {(s.note ?? (working ? "working" : null)) && <span className="text-muted-foreground">{s.note ?? "working"}</span>}
          </StatusDot>
        </span>
      ))}
    </div>
  );
}

/** A row of figures with thin dividers between them: a label above, the value in one weight below. */
export function Tiles({ children, testId, cols }: { children: React.ReactNode; testId?: string; cols: 4 | 5 }) {
  return (
    <div data-testid={testId} className={cols === 5 ? "grid grid-cols-5 border-y" : "grid grid-cols-4 border-y"}>
      {children}
    </div>
  );
}

export function Tile({ label, value, of, note, testId }: { label: string; value: string; of?: string; note?: string | null; testId?: string }) {
  return (
    <div data-testid={testId} className="py-2.5 pr-3 [&+&]:border-l [&+&]:pl-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-px text-lg font-semibold tracking-tight text-foreground">
        {value}
        {of && <span className="ml-1 text-[11px] font-normal tracking-normal text-muted-foreground">{of}</span>}
      </div>
      {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const Label = ({ children }: { children: React.ReactNode }) => <p className="mt-5 mb-1.5 text-[11px] text-muted-foreground">{children}</p>;

/**
 * Is Blink working? One headline figure (the typical time from words to warning, with the 19-in-20
 * and slowest beside it), four figures, the stages, every recent problem, and the recent calls.
 * Every figure covers every call so far; only the stages look at the last hour. `canOpen` is false
 * for the policy owner, who may not open a call: no problem links to one and no call is listed.
 */
export function CallsOverviewView({ overview: o, canOpen }: { overview: CallsOverview; canOpen: boolean }) {
  const { p50, p95, max, n } = o.latency;
  const speed = speedFormatter(max ?? 0);
  const cost = o.calls === 0 ? "—" : o.typicalCostUsd === null ? "unknown" : dollars(o.typicalCostUsd);
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-4 flex items-end gap-5">
        <div data-testid="hero-latency" className="text-[52px] leading-none font-semibold tracking-tight text-foreground">
          {p50 === null ? "—" : speed(p50)}
        </div>
        <div data-testid="hero-caption" className="pb-0.5">
          <b className="block text-[13px] font-semibold text-foreground">Typical time from words to warning</b>
          <span className="block text-xs text-muted-foreground">
            {p50 === null || p95 === null || max === null
              ? "No turn has been timed yet, so there is no 19 in 20 or slowest time."
              : `19 in 20 warnings arrive within ${speed(p95)}. Slowest: ${speed(max)}. Measured on ${plural(n, "turn")}, every call so far.`}
          </span>
        </div>
      </div>

      <Tiles cols={4} testId="overview-tiles">
        <Tile testId="tile-calls" label="Calls" value={String(o.calls)} />
        <Tile testId="tile-problems" label="Turns with a problem" value={String(o.turnsWithProblem)} of={`of ${o.turns}`} />
        <Tile testId="tile-unhidden" label="Unhidden by compliance" value={String(o.unhidden)} of={`of ${o.hidden} hidden`} />
        <Tile testId="tile-cost" label="Typical cost per call" value={cost} note={cost === "unknown" ? "a call has a step with no price" : null} />
      </Tiles>

      <Label>Each part of the live path, over the last hour</Label>
      <StageRow stages={o.stages} working />

      <Label>Recent problems</Label>
      {o.problems.length === 0 ? (
        <p className="border-t py-2.5 text-[13px] text-muted-foreground">No problem on any call so far.</p>
      ) : (
        o.problems.map((p, i) => (
          <div key={i} data-testid={`problem-${i}`} className="grid grid-cols-[148px_minmax(0,1fr)_auto] gap-3 border-t py-2.5 text-[13px]">
            <span className="pt-px font-mono text-[11px] text-muted-foreground">{formatDateTime(p.at)}</span>
            <span className="text-foreground">
              {p.title && <span className="text-muted-foreground">{p.title} · </span>}
              {p.text}
            </span>
            {canOpen && p.callId ? (
              <Link href={`/calls/${p.callId}`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                Open call →
              </Link>
            ) : (
              <span />
            )}
          </div>
        ))
      )}

      {!canOpen && <p className="mt-4 text-xs text-muted-foreground">You see how the calls went, never what was said on them, so no problem here links to its call.</p>}
      {canOpen && (
        <>
          <Label>Recent calls</Label>
          {o.recent.length === 0 ? (
            <p className="border-t py-2.5 text-[13px] text-muted-foreground">No call yet.</p>
          ) : (
            o.recent.map((c) => (
              <div key={c.callId} className="border-t py-1">
                <Link href={`/calls/${c.callId}`} data-testid={`call-link-${c.callId}`} className="-mx-2 grid grid-cols-[148px_minmax(0,1fr)_auto] gap-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-muted">
                  <span className="pt-px font-mono text-[11px] text-muted-foreground">{formatDateTime(c.startedAt)}</span>
                  <span className="font-medium text-foreground">{c.title}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {plural(c.turns, "turn")} · {plural(c.warnings, "warning")}
                  </span>
                </Link>
              </div>
            ))
          )}
        </>
      )}
    </section>
  );
}
