import Link from "next/link";
import { PageShell } from "@/components/app/page-shell";
import { StateChip } from "@/components/app/status-chip";
import { StatusDot, dotOf } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, humanize } from "@/lib/format";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listCases, queueSummary } from "@/server/services/cases";
import { activePolicyVersion } from "@/server/services/loaders";

const OPEN_STATES = ["REVIEW_REQUIRED", "NEEDS_CONTEXT", "ESCALATED", "NOT_TRIGGERED_PENDING_ACK"];

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-muted-foreground">
      <span className="font-semibold text-foreground tabular-nums">{value}</span> {label}
    </span>
  );
}

function loadQueue(actor: Awaited<ReturnType<typeof pageActor>>) {
  try {
    const db = getDb();
    return { cases: listCases(db, actor), summary: queueSummary(db, actor), policy: activePolicyVersion(db), ready: true as const };
  } catch {
    return { cases: [], summary: { inReview: 0, avgReviewMinutes: null, awaitingEscalation: null }, policy: null, ready: false as const };
  }
}

export default async function CasesPage() {
  const actor = await pageActor();
  const { cases, summary, policy, ready } = loadQueue(actor);
  const reviewer = actor.role === "reviewer" || actor.role === "senior_reviewer";

  return (
    <PageShell
      title="Cases"
      actions={
        actor.role === "analyst" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="outline" className="h-12 px-6 text-base" data-testid="new-case">
              <Link href="/cases/new">New case</Link>
            </Button>
            <Button asChild className="h-12 px-8 text-base">
              <Link href="/call">Start call</Link>
            </Button>
          </div>
        ) : null
      }
    >
      {!ready && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-base text-foreground">
          The database has not been set up yet. Run <code className="font-mono">pnpm db:reset</code> and reload.
        </div>
      )}
      {ready && !policy && (
        <div className="glass-surface mb-6 flex items-center justify-between gap-6 px-7 py-5 text-base text-foreground" data-testid="no-policy-banner">
          <span className="text-lg">No policy is active. Nothing is evaluated until one is approved.</span>
          <Button asChild className="h-10 px-5">
            <Link href="/policies">Go to Policy</Link>
          </Button>
        </div>
      )}

      {reviewer && summary.inReview > 0 && (
        <div className="mb-6 flex flex-wrap items-baseline gap-x-8 gap-y-1 text-base" data-testid="queue-figures">
          <Figure label="in review" value={String(summary.inReview)} />
          {summary.avgReviewMinutes !== null && <Figure label="average review" value={`${summary.avgReviewMinutes} min`} />}
          {summary.awaitingEscalation ? <Figure label="escalated" value={String(summary.awaitingEscalation)} /> : null}
        </div>
      )}

      {cases.length === 0 ? (
        <div className="glass-surface flex min-h-72 flex-col items-center justify-center px-8 py-16 text-center">
          <p className="text-4xl text-foreground">No cases yet.</p>
        </div>
      ) : (
        <div className="glass-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Case</TableHead>
                <TableHead>Expert</TableHead>
                <TableHead>Call date</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Findings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cases.map((c) => {
                const open = c.findingCounts ? OPEN_STATES.filter((s) => (c.findingCounts![s] ?? 0) > 0) : [];
                return (
                  <TableRow key={c.id} data-testid={`case-row-${c.id}`}>
                    <TableCell className="font-medium text-foreground">
                      <Link href={`/cases/${c.id}`} className="text-lg hover:underline">
                        {c.title}
                      </Link>
                    </TableCell>
                    <TableCell>{c.expertName}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{formatDate(c.callDate)}</TableCell>
                    <TableCell>
                      <StateChip state={c.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.findingCounts === null ? (
                        <span className="text-muted-foreground">Compliance only</span>
                      ) : open.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="inline-flex flex-wrap justify-end gap-x-3 gap-y-0.5">
                          {open.map((s) => (
                            <StatusDot key={s} tone={dotOf(s)}>
                              {c.findingCounts![s]} {humanize(s).toLowerCase()}
                            </StatusDot>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </PageShell>
  );
}
