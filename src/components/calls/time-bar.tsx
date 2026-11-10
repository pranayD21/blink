/**
 * Small pieces shared by the observability screens, on the server and in the browser alike: how a
 * span of time is written, and the thin bar that shows when one step ran and for how long.
 */

/** "4 ms" under a tenth of a second, "0.9 s" under ten, then whole seconds: "19 s". */
export function formatSpan(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 100) return `${Math.round(v)} ms`;
  if (v < 10_000) return `${(v / 1000).toFixed(1)} s`;
  return `${Math.round(v / 1000)} s`;
}

/** Seconds to one decimal, always: the headline speed figures ("1.1 s"). */
export const formatSeconds = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * One step on a track that spans the whole moment, from the end of the speech (left) to the last
 * step's end (right). A single colour: the bar's position is the information. A step with no time
 * (hidden, reviewed) gets no track at all.
 */
export function TimeBar({ offsetMs, durationMs, domainMs }: { offsetMs: number | null; durationMs: number | null; domainMs: number }) {
  if (offsetMs === null || durationMs === null || domainMs <= 0) return <div aria-hidden="true" className="h-2" />;
  const left = clamp01(offsetMs / domainMs) * 100;
  const width = Math.min(100 - left, clamp01(durationMs / domainMs) * 100);
  const label = `Started ${formatSpan(offsetMs)} after the speech ended and took ${formatSpan(durationMs)}`;
  return (
    <div role="img" aria-label={label} title={label} className="relative mt-1.5 h-2 rounded-full bg-secondary">
      <span className="absolute inset-y-0 min-w-[3px] rounded-full bg-foreground/80" style={{ left: `min(${left}%, calc(100% - 3px))`, width: `${width}%` }} />
    </div>
  );
}
