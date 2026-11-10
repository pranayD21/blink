"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobProgress } from "@/components/app/job-progress";
import { PageShell, Panel } from "@/components/app/page-shell";
import { StateChip } from "@/components/app/status-chip";
import { formatDate, formatDateTime } from "@/lib/format";
import type { analystCaseView } from "@/server/services/cases";
import { ANALYSIS_STAGES } from "./case-header";
import { type TranscriptSample, TranscriptUploadForm } from "./upload-transcript";

type View = NonNullable<ReturnType<typeof analystCaseView>>;

const STATUS_TEXT: Record<string, string> = {
  INTAKE: "Waiting for the call transcript.",
  ANALYZING: "The transcript is being analyzed.",
  ANALYSIS_FAILED: "The analysis did not finish. Compliance can see why and re-run it.",
  IN_REVIEW: "Compliance is reviewing this call.",
  READY_FOR_APPROVAL: "Compliance has finished the review and is preparing the brief.",
  APPROVED: "A brief has been approved and is about to be released.",
  RELEASED: "A brief has been released to you.",
  STALE: "The evidence changed after approval. Compliance is reviewing the call again.",
};

/** The banker's side of a case: packet, transcript upload, progress. Findings are never shown here (§14). */
export function AnalystCase({ view, samples, allowGold }: { view: View; samples: TranscriptSample[]; allowGold: boolean }) {
  const router = useRouter();
  const [liveJob, setLiveJob] = useState<string | null>(null);
  const jobId = liveJob ?? (view.job && (view.job.status === "queued" || view.job.status === "running") ? view.job.id : null);
  const packet = view.packet;

  return (
    <PageShell
      title={
        <span className="flex items-center gap-3">
          {view.case.title} <StateChip state={view.case.status} data-testid="case-status" />
        </span>
      }
      description={STATUS_TEXT[view.case.status]}
    >
      <div className="grid grid-cols-[1fr_22rem] items-start gap-4">
        <div className="space-y-4">
          {jobId && (
            <JobProgress
              jobId={jobId}
              label="Analyzing the transcript"
              stages={ANALYSIS_STAGES}
              onFinished={() => {
                setLiveJob(null);
                router.refresh();
              }}
            />
          )}
          <Panel title={view.transcripts.length > 0 ? "Upload a corrected transcript" : "Upload the call transcript"}>
            <TranscriptUploadForm
              caseId={view.case.id}
              samples={samples}
              allowGold={allowGold}
              onUploaded={(id) => {
                setLiveJob(id);
                router.refresh();
              }}
            />
          </Panel>
          {view.transcripts.length > 0 && (
            <Panel title="Transcript versions">
              <ul className="space-y-1 text-sm">
                {view.transcripts.map((t) => (
                  <li key={t.versionNo} className="flex justify-between">
                    <span>
                      <span className="font-mono text-muted-foreground">v{t.versionNo}</span> {t.sourceLabel}
                    </span>
                    <span className="text-muted-foreground">{formatDateTime(t.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <p className="text-sm text-muted-foreground">
            Compliance findings are not visible to bankers. When a brief is released it appears under{" "}
            <Link href="/analyst" className="font-medium text-foreground underline underline-offset-2">
              Released briefs
            </Link>
            {view.released ? "; one has been released for this case." : "."}
          </p>
        </div>

        <Panel title="Case packet">
          {packet ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Covered issuer</dt>
                <dd>
                  {view.case.issuer} ({view.case.ticker})
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Call date</dt>
                <dd>{formatDate(packet.callDate)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Expert</dt>
                <dd>
                  {packet.expert?.name}
                  <div className="text-xs text-muted-foreground">
                    {packet.expert?.currentTitle}
                    {packet.expert?.currentEmployer ? `, ${packet.expert.currentEmployer}` : ""}
                  </div>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Research questions</dt>
                <dd>
                  <ul className="list-disc space-y-0.5 pl-4">
                    {packet.researchQuestions.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted-foreground">No packet.</p>
          )}
        </Panel>
      </div>
    </PageShell>
  );
}
