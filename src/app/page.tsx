import { ArrowRight, Plus } from "lucide-react";
import Link from "next/link";
import { PageShell, Stat } from "@/components/app/page-shell";
import { Chip, StateChip, toneOf } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCases, queueSummary } from "@/server/services/cases";
import { activePolicyVersion } from "@/server/services/loaders";

const OPEN_STATES = ["REVIEW_REQUIRED", "NEEDS_CONTEXT", "ESCALATED", "NOT_TRIGGERED_PENDING_ACK"];

function loadQueue(actor: Awaited<ReturnType<typeof pageActor>>) {
  try {
    const db = getDb();
    return { cases: listCases(db, actor), summary: queueSummary(db, actor), policy: activePolicyVersion(db), ready: true as const };
  } catch {
    return { cases: [], summary: { inReview: 0, avgReviewMinutes: null, awaitingEscalation: null }, policy: null, ready: false as const };
  }
}

export default async function QueuePage() {
  const actor = await pageActor();
  const { cases, summary, policy, ready } = loadQueue(actor);
  const reviewer = actor.role === "reviewer" || actor.role === "senior_reviewer";

  return (
    <PageShell
      title="Case queue"
      description="Expert calls waiting for compliance review. Blink extracts what the expert said, checks it against the approved policy, and records what each decision was based on."
      actions={
        actor.role === "analyst" ? (
          <Button asChild size="sm">
            <Link href="/cases/new">
              <Plus /> New case
            </Link>
          </Button>
        ) : null
      }
    >
      {!ready && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          The database has not been set up yet. Run <code className="font-mono">pnpm db:reset</code> and reload.
        </div>
      )}
      {ready && !policy && (
        <div className="mb-4 flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" data-testid="no-policy-banner">
          <span>No policy is active yet. Calls can be uploaded, but nothing is evaluated until the policy owner approves a compiled policy.</span>
          <Link href="/policies" className="shrink-0 font-medium underline underline-offset-2">
            Go to Policy
          </Link>
        </div>
      )}

      <div className="mb-5 grid grid-cols-3 gap-3">
        <Stat label="Cases in review" value={summary.inReview} />
        <Stat label="Average review time" value={summary.avgReviewMinutes === null ? "—" : `${summary.avgReviewMinutes} min`} hint={reviewer ? "active minutes per case, measured" : "visible to compliance"} />
        <Stat label="Findings awaiting escalation" value={summary.awaitingEscalation ?? "—"} hint={reviewer ? "need a senior compliance officer" : "visible to compliance"} />
      </div>

      <div className="overflow-hidden rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead>Case</TableHead>
              <TableHead>Issuer</TableHead>
              <TableHead>Expert</TableHead>
              <TableHead>Call date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Open findings</TableHead>
              <TableHead>Time in review</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-slate-500">
                  No cases yet.
                </TableCell>
              </TableRow>
            )}
            {cases.map((c) => {
              const open = c.findingCounts ? OPEN_STATES.filter((s) => (c.findingCounts![s] ?? 0) > 0) : [];
              return (
                <TableRow key={c.id} data-testid={`case-row-${c.id}`}>
                  <TableCell className="font-medium text-slate-900">
                    <Link href={`/cases/${c.id}`} className="hover:underline">
                      {c.title}
                    </Link>
                    <div className="text-xs font-normal text-slate-500">{c.transcriptVersion ? `transcript v${c.transcriptVersion}` : "no transcript yet"}</div>
                  </TableCell>
                  <TableCell>
                    {c.issuer} <span className="text-slate-400">({c.ticker})</span>
                  </TableCell>
                  <TableCell>{c.expertName}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(c.callDate)}</TableCell>
                  <TableCell>
                    <StateChip state={c.status} />
                  </TableCell>
                  <TableCell>
                    {c.findingCounts === null ? (
                      <span className="text-xs text-slate-400">compliance only</span>
                    ) : open.length === 0 ? (
                      <span className="text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {open.map((s) => (
                          <Chip key={s} tone={toneOf(s)} className="font-mono tracking-tight">
                            {c.findingCounts![s]} {s}
                          </Chip>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">{c.reviewMinutes === null ? "—" : `${c.reviewMinutes} min`}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/cases/${c.id}`}>
                        Open <ArrowRight />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}
