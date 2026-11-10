"use client";

import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface JobView {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string;
  progress: number;
  error: string | null;
  result: Record<string, unknown> | null;
}

const isLive = (status: string) => status === "queued" || status === "running";

/**
 * Polls a background job once a second (§14) and shows its stage. Calls
 * `onFinished` once when the job leaves the queue, so the page can reload.
 */
export function JobProgress({ jobId, label, stages, onFinished, className }: { jobId: string; label: string; stages?: string[]; onFinished?: (job: JobView) => void; className?: string }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [lost, setLost] = useState(false);
  const finished = useRef(false);
  const callback = useRef(onFinished);
  useEffect(() => {
    callback.current = onFinished;
  });

  useEffect(() => {
    finished.current = false;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { job: next } = await api<{ job: JobView }>(`/api/jobs/${jobId}`);
        if (stopped) return;
        setJob(next);
        setLost(false);
        if (!isLive(next.status)) {
          if (!finished.current) {
            finished.current = true;
            callback.current?.(next);
          }
          return;
        }
      } catch {
        if (!stopped) setLost(true);
      }
      timer = setTimeout(tick, 1000);
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const status = job?.status ?? "queued";
  const failed = status === "failed";
  const done = status === "succeeded";
  const current = job?.stage ?? "Queued";

  return (
    <div className={cn("rounded-lg border bg-card px-4 py-3", failed && "border-destructive/40 bg-destructive/10", className)} data-testid="job-progress" data-status={status}>
      <div className="flex items-center gap-2 text-sm">
        {failed ? <AlertTriangle className="size-4 text-destructive" /> : done ? <CheckCircle2 className="size-4 text-success" /> : <Loader2 className="size-4 animate-spin text-foreground" />}
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground" data-testid="job-stage">
          {failed ? "Failed" : current}
        </span>
        {status === "queued" && <span className="text-xs text-muted-foreground">waiting for the worker</span>}
        {lost && <span className="text-xs text-warning">connection lost, retrying…</span>}
      </div>
      {!failed && <Progress value={done ? 100 : (job?.progress ?? 0)} className="mt-2 h-1.5" />}
      {stages && !failed && (
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {stages.map((s, i) => {
            const at = stages.findIndex((x) => current.startsWith(x));
            const state = done || (at > -1 && i < at) ? "past" : i === at ? "now" : "next";
            return (
              <span key={s} className={cn(state === "now" && "font-semibold text-foreground", state === "past" && "text-foreground/70")}>
                {s}
                {i < stages.length - 1 && <span className="ml-2 text-border">·</span>}
              </span>
            );
          })}
        </div>
      )}
      {failed && job?.error && <p className="mt-2 text-sm text-destructive">{job.error}</p>}
    </div>
  );
}
