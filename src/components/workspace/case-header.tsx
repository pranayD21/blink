"use client";

import { AlertTriangle, AudioLines, ClipboardCheck, FileText, History, PlayCircle, RotateCcw, Timer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { JobProgress } from "@/components/app/job-progress";
import { StateChip } from "@/components/app/status-chip";
import { StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
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
        <p className="text-sm text-muted-foreground">The attestation depends on every turn of this transcript version. If any turn changes, it goes stale and must be made again.</p>
        {payload.attestation && (
          <StatusDot tone={current ? "good" : "stop"} className="items-start text-sm whitespace-normal [&>span:first-child]:mt-1.5">
            {current ? `Attested by ${userName(payload, payload.attestation.actorId)} on ${formatDateTime(payload.attestation.createdAt)}.` : `The earlier attestation is stale${payload.attestation.staleReason ? `: ${payload.attestation.staleReason}` : ": it covers an earlier transcript version"}.`}
          </StatusDot>
        )}
        {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">{error}</p>}
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
  const openFindings = payload.blockers.filter((b) => b.code === "FINDING_OPEN" || b.code === "DECISION_STALE");
  const otherBlockers = payload.blockers.filter((b) => b.code !== "FINDING_OPEN" && b.code !== "DECISION_STALE");

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
    <div className="shrink-0 border-b bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <h1 className="text-base font-semibold tracking-tight text-foreground">{payload.case.title}</h1>
        <StateChip state={payload.case.status} data-testid="case-status" />
        {policy ? (
          <Link href={`/policies/${policy.id}`} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:underline" data-testid="policy-badge">
            policy {policy.label} <StateChip state={policy.status} />
            {policy.compileSource === "manual" ? <StatusDot tone="warn">manual fallback</StatusDot> : <span>AI-compiled</span>}
          </Link>
        ) : (
          <StatusDot tone="stop" className="text-xs">no active policy</StatusDot>
        )}
        {run && (
          <span className="text-xs text-muted-foreground" data-testid="run-badge">
            run #{run.runNo} · transcript v{payload.transcript?.versionNo}
          </span>
        )}
        {run?.source === "gold" && <StatusDot tone="warn" className="text-xs">hand-labeled claims (dev)</StatusDot>}
        {run?.replayed && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="This run replayed a recorded model response; no network call was made." data-testid="replayed-badge">
            <PlayCircle className="size-3" /> Replayed from recorded run · {formatDate(run.recordedAt)}
          </span>
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
          {payload.callId && (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/calls/${payload.callId}`} data-testid="link-call-record" title="The live call, moment by moment: what was heard, read, checked and shown">
                <AudioLines /> Call record
              </Link>
            </Button>
          )}
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
        <div key={issue.id} className="flex items-start gap-2 border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-foreground" data-testid="issue-blocking">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <span className="font-mono text-xs font-semibold">{issue.code}</span> {issue.message}
          </span>
        </div>
      ))}
      {warnings.length > 0 && (
        <details className="border-t border-warning/40 bg-warning/10 px-4 py-2 text-sm text-foreground" data-testid="issue-warning">
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t bg-muted px-4 py-1.5 text-xs text-muted-foreground" data-testid="readiness">
          {payload.blockers.length === 0 ? (
            <>
              <StatusDot tone="good">Review complete: every finding is decided and the whole call is attested.</StatusDot>
            </>
          ) : (
            <>
              <StatusDot tone="warn" className="font-medium text-foreground">Before a brief can be approved:</StatusDot>
              {openFindings.length > 0 && (
                <span className="rounded bg-background px-1.5 py-0.5 ring-1 ring-border" data-testid="blocker" title={openFindings.map((b) => b.message).join("\n")}>
                  {openFindings.length === 1 ? openFindings[0].message : `${openFindings.length} findings to decide`}
                </span>
              )}
              {otherBlockers.map((b, i) => (
                <span key={i} className="rounded bg-background px-1.5 py-0.5 ring-1 ring-border" data-testid="blocker">
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
