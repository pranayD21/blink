import { StatusDot } from "@/components/app/status-dot";
import { formatDateTime, plural } from "@/lib/format";
import type { ReleasedTranscript } from "@/server/services/released";

/** A blanked run is a bar sized by how many characters it replaces. The characters themselves never reach this component. */
function HiddenBar({ length }: { length: number }) {
  return <span role="img" aria-label="Hidden by compliance" data-testid="hidden-bar" className="mx-0.5 inline-block h-[0.9em] max-w-full rounded-sm bg-muted-foreground/40 align-middle" style={{ width: `${Math.max(1, length)}ch` }} />;
}

/** The released transcript as a banker reads it: one line per turn, with whatever compliance kept hidden blanked. */
export function ReleasedTranscriptView({ view }: { view: ReleasedTranscript }) {
  const { release, turns, hiddenPassages } = view;
  if (!view.available) {
    return (
      <p className="rounded-lg border border-dashed bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground" data-testid="transcript-unavailable">
        The transcript for this release is not available.
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="released-transcript" data-standing={release.standing}>
      {release.standing === "superseded" && (
        <p className="rounded-lg border bg-muted px-4 py-2 text-sm text-foreground" data-testid="superseded-banner">
          <StatusDot tone="warn">Superseded. A newer version of this call has been released; use that one.</StatusDot>
        </p>
      )}
      {release.standing === "under_re_review" && (
        <p className="rounded-lg border bg-muted px-4 py-2 text-sm text-foreground" data-testid="re-review-banner">
          <StatusDot tone="stop">Under re-review. The transcript below is the one released on {formatDateTime(release.releasedAt)}. A corrected transcript is with compliance; do not rely on this one until it is released again.</StatusDot>
        </p>
      )}
      <p className="text-sm text-muted-foreground" data-testid="hidden-count">
        {hiddenPassages === 0 ? "No passages were hidden by compliance." : `${plural(hiddenPassages, "passage")} hidden by compliance.`}
      </p>
      <ol className="space-y-2.5 rounded-xl border bg-card p-4 text-sm leading-relaxed text-foreground">
        {turns.map((turn) => (
          <li key={turn.label} className="flex gap-3" data-testid={`turn-${turn.label}`}>
            <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">{turn.label}</span>
            <span className="min-w-0">
              <span className="font-medium">{turn.speakerName}</span>
              {turn.timestamp && <span className="ml-2 text-xs text-muted-foreground">{turn.timestamp}</span>}
              <span className="block">
                {turn.segments.map((segment, i) => ("hidden" in segment ? <HiddenBar key={i} length={segment.hidden} /> : <span key={i}>{segment.text}</span>))}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
