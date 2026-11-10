import { Plus } from "lucide-react";
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

/** One figure on the line above the queue: the value in one weight, its label beside it. */
function Figure({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <span className="text-muted-foreground">
      <span className="font-semibold text-foreground tabular-nums">{value}</span> {label}
      {note && <span className="ml-1.5 text-xs">({note})</span>}
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

export default async function QueuePage() {
  const actor = await pageActor();
  const { cases, summary, policy, ready } = loadQueue(actor);
  const reviewer = actor.role === "reviewer" || actor.role === "senior_reviewer";

  return (
    <PageShell
      title="Case queue"
      description="Calls waiting for review."
      actions={
        actor.role === "analyst" ? (
          <Button asChild className="h-11 px-6">
            <Link href="/cases/new">
              <Plus /> New case
            </Link>
          </Button>
        ) : null
      }
    >
      {!ready && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          The database has not been set up yet. Run <code className="font-mono">pnpm db:reset</code> and reload.
        </div>
      )}
      {ready && !policy && (
        <div className="glass-surface mb-6 flex items-center justify-between gap-4 px-5 py-4 text-sm text-foreground" data-testid="no-policy-banner">
          <span>No policy is active yet. Nothing is evaluated until one is approved.</span>
          <Button asChild className="h-10 px-5">
            <Link href="/policies">Go to Policy</Link>
          </Button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-baseline gap-x-8 gap-y-1 border-y py-2.5 text-sm" data-testid="queue-figures">
        <Figure label="in review" value={String(summary.inReview)} />
        {reviewer && <Figure label="average review time" value={summary.avgReviewMinutes === null ? "none" : `${summary.avgReviewMinutes} min`} />}
        {reviewer && <Figure label="findings awaiting escalation" value={summary.awaitingEscalation === null ? "0" : String(summary.awaitingEscalation)} />}
      </div>

      {cases.length === 0 ? (
        <div className="glass-surface flex min-h-72 flex-col items-center justify-center px-8 py-16 text-center">
          <p className="font-serif text-4xl text-foreground">No cases yet.</p>
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
              <TableHead>Open findings</TableHead>
              <TableHead className="text-right">Time in review</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.map((c) => {
              const open = c.findingCounts ? OPEN_STATES.filter((s) => (c.findingCounts![s] ?? 0) > 0) : [];
              return (
                <TableRow key={c.id} data-testid={`case-row-${c.id}`}>
                  <TableCell className="font-medium text-foreground">
                    <Link href={`/cases/${c.id}`} className="hover:underline">
                      {c.title}
                    </Link>
                    <div className="text-xs font-normal text-muted-foreground">
                      {c.issuer} ({c.ticker}) · {c.transcriptVersion ? `transcript v${c.transcriptVersion}` : "no transcript yet"}
                    </div>
                  </TableCell>
                  <TableCell>{c.expertName}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(c.callDate)}</TableCell>
                  <TableCell>
                    <StateChip state={c.status} />
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {c.findingCounts === null ? (
                      <span className="text-muted-foreground">compliance only</span>
                    ) : open.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {open.map((s) => (
                          <StatusDot key={s} tone={dotOf(s)}>
                            {c.findingCounts![s]} {humanize(s).toLowerCase()}
                          </StatusDot>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.reviewMinutes === null ? "—" : `${c.reviewMinutes} min`}</TableCell>
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
