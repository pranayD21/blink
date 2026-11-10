"use client";

import { Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useReviewTimer } from "@/components/workspace/use-review-timer";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatMinutes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { baselineView } from "@/server/services/sessions";

type View = ReturnType<typeof baselineView>;

const OUTCOMES = [
  { value: "no_concern", label: "No concern" },
  { value: "needs_follow_up", label: "Needs follow-up" },
  { value: "restricted", label: "Restricted" },
];

/**
 * Baseline mode (§15.1): the same review with only the transcript and a plain
 * summary, timed, so the metrics page can compare it with a Blink review.
 */
export function BaselineReview({ view, users }: { view: View; users: Record<string, string> }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState("needs_follow_up");
  const [flagged, setFlagged] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  useReviewTimer(view.case.id, "baseline", done === null && Boolean(view.transcript));

  useEffect(() => {
    if (done !== null) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [done]);

  async function submit() {
    setBusy(true);
    try {
      const res = await api<{ activeMs: number }>(`/api/cases/${view.case.id}/baseline`, { body: { outcome, flaggedTurns: flagged, notes } });
      setDone(res.activeMs);
      toast.success("Baseline review recorded.");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!view.transcript) return <p className="text-sm text-muted-foreground">This case has no transcript yet.</p>;

  return (
    <div className="grid grid-cols-[1fr_22rem] items-start gap-4">
      <Panel title={`Transcript v${view.transcript.versionNo}`} bodyClassName="p-0">
        <div className="max-h-[70vh] divide-y divide-border overflow-y-auto">
          {view.transcript.turns.map((t) => (
            <label key={t.label} className={cn("flex cursor-pointer items-start gap-3 px-4 py-2 text-sm hover:bg-muted/60", flagged.includes(t.label) && "bg-muted hover:bg-muted")}>
              <input type="checkbox" className="mt-1" checked={flagged.includes(t.label)} onChange={(e) => setFlagged((f) => (e.target.checked ? [...f, t.label] : f.filter((x) => x !== t.label)))} aria-label={`Flag ${t.label}`} />
              <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">{t.label}</span>
              <span>
                <span className="text-xs font-semibold text-muted-foreground capitalize">{t.speaker}</span> <span className="text-foreground">{t.text}</span>
              </span>
            </label>
          ))}
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Review timer" bodyClassName="p-3">
          <div className="flex items-center gap-2 text-2xl font-semibold text-foreground tabular-nums" data-testid="baseline-timer">
            <Timer className="size-5 text-muted-foreground" />
            {done !== null ? formatMinutes(done) : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Counts active time only: the clock pauses after two minutes without activity and stops when you record a decision.</p>
        </Panel>

        <Panel title="AI summary" bodyClassName="p-3">
          <p className="text-sm text-foreground">{view.summary ?? "No summary: the call has not been analyzed yet."}</p>
          <p className="mt-2 text-xs text-muted-foreground">{view.summarySource === "gold" ? "Hand-written summary (development data)." : "A plain summary with no claims, findings, traces, or public-evidence comparison: what a reviewer has without Blink."}</p>
        </Panel>

        <Panel title="Your decision" bodyClassName="space-y-2 p-3">
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid="baseline-outcome">
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Flagged turns: {flagged.length > 0 ? flagged.join(", ") : "none (tick turns in the transcript)"}</p>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you decided and why (at least 10 characters)" className="h-24 text-sm" data-testid="baseline-notes" />
          <Button className="w-full" disabled={busy || done !== null || notes.trim().length < 10} onClick={submit} data-testid="baseline-submit">
            {done !== null ? "Recorded" : "Record decision and stop the timer"}
          </Button>
        </Panel>

        {view.sessions.filter((s) => s.endedAt).length > 0 && (
          <Panel title="Earlier baseline reviews" bodyClassName="p-3">
            <ul className="space-y-1 text-xs text-muted-foreground">
              {view.sessions
                .filter((s) => s.endedAt)
                .map((s) => (
                  <li key={s.id} className="flex justify-between gap-2">
                    <span>
                      {users[s.actorId] ?? s.actorId} · {s.outcome?.outcome.replaceAll("_", " ") ?? "no decision"}
                    </span>
                    <span className="tabular-nums">
                      {formatMinutes(s.activeMs)} · {formatDateTime(s.endedAt)}
                    </span>
                  </li>
                ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
