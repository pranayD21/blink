"use client";

import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, History, PlayCircle, RotateCcw, Timer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { JobProgress } from "@/components/app/job-progress";
import { Chip, StateChip } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkspacePayload } from "@/server/services/workspace";
import { userName } from "./model";
import { type TranscriptSample, UploadTranscriptDialog } from "./upload-transcript";

export const ANALYSIS_STAGES = ["Parsing", "Extracting claims", "Validating quotes", "Comparing public evidence", "Evaluating policy", "Done"];

function AttestDialog({ payload, refresh }: { payload: WorkspacePayload; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcript = payload.transcript;
  if (!transcript) return null;
  const current = payload.attestation?.current ?? false;

  async function attest() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ status: string }>(`/api/cases/${payload.case.id}/attest`, { body: { transcriptVersionId: transcript!.id } });
      toast.success(res.status === "READY_FOR_APPROVAL" ? "Attested. The case is ready for approval." : "Attestation recorded.");
      setOpen(false);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={current ? "outline" : "default"} data-testid="open-attest">
          <ClipboardCheck /> {current ? "Attested" : payload.attestation ? "Re-attest" : "Attest"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Whole-call attestation</DialogTitle>
          <DialogDescription>
            You are stating that you reviewed the entire call in transcript v{transcript.versionNo} ({transcript.turns.length} turns), not only the flagged passages. Extraction can miss a statement; this attestation is the control for that, and it is required even when there are no findings.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-slate-600">The attestation depends on every turn of this transcript version. If any turn changes, it goes stale and must be made again.</p>
        {payload.attestation && (
          <p className={cn("rounded-md px-3 py-2 text-sm", current ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}>
            {current ? `Attested by ${userName(payload, payload.attestation.actorId)} on ${formatDateTime(payload.attestation.createdAt)}.` : `The earlier attestation is stale${payload.attestation.staleReason ? `: ${payload.attestation.staleReason}` : ": it covers an earlier transcript version"}.`}
          </p>
        )}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={attest} disabled={busy || current} data-testid="confirm-attest">
            {current ? "Already attested" : "I reviewed the whole call"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CaseHeader({ payload, samples, allowGold, refresh }: { payload: WorkspacePayload; samples: TranscriptSample[]; allowGold: boolean; refresh: () => void }) {
  const [liveJob, setLiveJob] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const { run, policy, job } = payload;
  const jobId = liveJob ?? (job && (job.status === "queued" || job.status === "running") ? job.id : null);
  const blocking = payload.issues.filter((i) => !i.resolved && i.severity === "blocking");
  const warnings = payload.issues.filter((i) => !i.resolved && i.severity === "warning");

  async function rerun() {
    setRerunning(true);
    try {
      const res = await api<{ jobId: string }>(`/api/cases/${payload.case.id}/analyze`, { body: {} });
      setLiveJob(res.jobId);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRerunning(false);
    }
  }

  return (
    <div className="shrink-0 border-b bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <h1 className="text-base font-semibold tracking-tight text-slate-900">{payload.case.title}</h1>
        <StateChip state={payload.case.status} data-testid="case-status" />
        {policy ? (
          <Link href={`/policies/${policy.id}`} className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:underline" data-testid="policy-badge">
            policy {policy.label} <StateChip state={policy.status} /> <Chip tone={policy.compileSource === "manual" ? "amber" : "indigo"}>{policy.compileSource === "manual" ? "manual fallback" : "AI-compiled"}</Chip>
          </Link>
        ) : (
          <Chip tone="red">no active policy</Chip>
        )}
        {run && (
          <span className="text-xs text-slate-500" data-testid="run-badge">
            run #{run.runNo} · transcript v{payload.transcript?.versionNo}
          </span>
        )}
        {run?.source === "gold" && <Chip tone="amber">hand-labeled claims (dev)</Chip>}
        {run?.replayed && (
          <Chip tone="sky" title="This run replayed a recorded model response; no network call was made." data-testid="replayed-badge">
            <PlayCircle className="size-3" /> Replayed from recorded run · {formatDate(run.recordedAt)}
          </Chip>
        )}
        <div className="ml-auto flex items-center gap-2">
          <UploadTranscriptDialog caseId={payload.case.id} samples={samples} allowGold={allowGold} currentVersion={payload.transcript?.versionNo ?? null} onUploaded={(id) => (setLiveJob(id), refresh())} />
          {payload.transcript && (
            <Button size="sm" variant="ghost" onClick={rerun} disabled={rerunning || Boolean(jobId)} title="Run the analysis again on the current transcript, as a new run">
              <RotateCcw /> Re-run
            </Button>
          )}
          <Button asChild size="sm" variant="ghost">
            <Link href={`/cases/${payload.case.id}/baseline`} title="Time the same review without Blink's evidence (metrics)">
              <Timer /> Baseline
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/cases/${payload.case.id}/audit`} data-testid="link-audit">
              <History /> Audit
            </Link>
          </Button>
          <AttestDialog payload={payload} refresh={refresh} />
          <Button asChild size="sm" variant="outline">
            <Link href={`/cases/${payload.case.id}/brief`} data-testid="link-brief">
              <FileText /> Brief →
            </Link>
          </Button>
        </div>
      </div>

      {jobId && (
        <div className="px-4 pb-3">
          <JobProgress
            jobId={jobId}
            label="Analyzing the transcript"
            stages={ANALYSIS_STAGES}
            onFinished={() => {
              setLiveJob(null);
              refresh();
            }}
          />
        </div>
      )}

      {blocking.map((issue) => (
        <div key={issue.id} className="flex items-start gap-2 border-t border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900" data-testid="issue-blocking">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-mono text-xs font-semibold">{issue.code}</span> {issue.message}
          </span>
        </div>
      ))}
      {warnings.length > 0 && (
        <details className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" data-testid="issue-warning">
          <summary className="cursor-pointer">
            {warnings.length} processing warning{warnings.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4 text-xs">
            {warnings.map((w) => (
              <li key={w.id}>
                <span className="font-mono font-semibold">{w.code}</span> {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {payload.transcript && !jobId && payload.case.status !== "ANALYSIS_FAILED" && (
        <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-1.5 text-xs", payload.blockers.length === 0 ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600")} data-testid="readiness">
          {payload.blockers.length === 0 ? (
            <>
              <CheckCircle2 className="size-3.5" /> Review complete: every finding is decided and the whole call is attested.
            </>
          ) : (
            <>
              <span className="font-medium text-slate-700">Before a brief can be approved:</span>
              {payload.blockers.map((b, i) => (
                <span key={i} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-slate-200" data-testid="blocker">
                  {b.message}
                </span>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
