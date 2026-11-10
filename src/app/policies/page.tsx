import { Plus } from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/app/page-shell";
import { StateChip } from "@/components/app/status-chip";
import { StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatDateTime, shortHash } from "@/lib/format";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { listPolicyVersions } from "@/server/services/policies";

export default async function PoliciesPage() {
  const actor = await pageActor();
  const versions = listPolicyVersions(getDb());
  const owner = actor.role === "policy_owner";
  return (
    <PageShell
      title="Policy versions"
      description="The firm's expert-call policy, compiled into monitors that code can check. A model drafts the compilation; a validator enumerates every combination of evidence; the policy owner approves one exact bundle hash. Only an ACTIVE version is used to evaluate calls."
      actions={
        owner ? (
          <Button asChild size="sm" data-testid="new-policy">
            <Link href="/policies/new">
              <Plus /> New policy version
            </Link>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Read-only: only the policy owner can compile or approve.</span>
        )
      }
    >
      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted hover:bg-muted">
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Compiled by</TableHead>
              <TableHead>Validation</TableHead>
              <TableHead>Reviewer scenarios</TableHead>
              <TableHead>Bundle hash</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {versions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground" data-testid="no-policies">
                  No policy version yet. {owner ? "Create one to start evaluating calls." : "The policy owner creates and approves one."}
                </TableCell>
              </TableRow>
            )}
            {versions.map((v) => (
              <TableRow key={v.id} data-testid={`policy-row-${v.label}`}>
                <TableCell className="font-medium">
                  <Link href={`/policies/${v.id}`} className="hover:underline">
                    {v.label}
                  </Link>
                  <div className="max-w-36 truncate text-xs font-normal text-muted-foreground">{v.title}</div>
                </TableCell>
                <TableCell>
                  <StateChip state={v.status} />
                </TableCell>
                <TableCell>{v.status === "DRAFT" ? <span className="text-muted-foreground">—</span> : v.compileSource === "manual" ? <StatusDot tone="warn">manual fallback</StatusDot> : <span>AI-compiled</span>}</TableCell>
                <TableCell className="text-sm">
                  {v.combinations > 0 ? `${formatCount(v.combinations)} combinations · ${v.monitors} monitors` : <span className="text-muted-foreground">—</span>}
                  {v.blocking > 0 && <div><StatusDot tone="stop" className="text-xs">{v.blocking} blocking</StatusDot></div>}
                  {v.warnings > 0 && <div><StatusDot tone="warn" className="text-xs">{v.warnings} warnings</StatusDot></div>}
                </TableCell>
                <TableCell>{v.reviewerScenarios ? `${v.reviewerScenarios.passed}/${v.reviewerScenarios.total}` : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{shortHash(v.bundleHash, 12)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(v.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}
