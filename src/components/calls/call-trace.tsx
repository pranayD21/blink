import { type CallTraceView, clockLabel, dollars } from "@/server/services/observability";
import { StageRow, Tile, Tiles } from "./calls-overview";
import { MomentList } from "./moment-steps";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * One call, top to bottom (spec section 8): the counts, the health of each stage, then one line per
 * moment in order. Quiet moments stay quiet; warnings and problems carry a coloured dot.
 */
export function CallTrace({ view }: { view: CallTraceView }) {
  const { counts } = view;
  return (
    <section className="rounded-xl border bg-card p-4">
      <Tiles cols={5} testId="call-counts">
        <Tile label="Turns heard" value={String(counts.turns)} />
        <Tile label="Warnings shown" value={String(counts.warnings)} />
        <Tile label="Passages hidden" value={String(counts.hidden)} />
        <Tile label="Problems" value={String(counts.problems)} />
        <Tile label="Cost" value={counts.costUsd === null ? "unknown" : dollars(counts.costUsd)} note={counts.callsWithoutPrice > 0 ? `${plural(counts.callsWithoutPrice, "step")} ${counts.callsWithoutPrice === 1 ? "has" : "have"} no price` : null} />
      </Tiles>
      <div className="mt-3 mb-2.5">
        <StageRow stages={view.stages} />
      </div>
      {view.call.status === "live" && <p className="mb-2 text-xs text-muted-foreground">The call is still going. Reload the page to see newer moments.</p>}
      <MomentList moments={view.moments.map((m) => ({ ...m, at: clockLabel(m.atMs) }))} />
    </section>
  );
}
