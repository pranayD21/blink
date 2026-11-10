import { Plus } from "lucide-react";
import Link from "next/link";
import { PageShell } from "@/components/app/page-shell";
import { Chip, StateChip } from "@/components/app/status-chip";
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
          <span className="text-xs text-slate-500">Read-only: only the policy owner can compile or approve.</span>
        )
      }
    >
      <div className="overflow-hidden rounded-xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
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
                <TableCell colSpan={7} className="py-8 text-center text-slate-500" data-testid="no-policies">
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
                  <div className="max-w-64 truncate text-xs font-normal text-slate-500">{v.title}</div>
                </TableCell>
                <TableCell>
                  <StateChip state={v.status} />
                </TableCell>
                <TableCell>{v.status === "DRAFT" ? <span className="text-slate-400">—</span> : <Chip tone={v.compileSource === "manual" ? "amber" : "indigo"}>{v.compileSource === "manual" ? "manual fallback" : "AI-compiled"}</Chip>}</TableCell>
                <TableCell className="text-sm">
                  {v.combinations > 0 ? `${formatCount(v.combinations)} combinations · ${v.monitors} monitors` : <span className="text-slate-400">—</span>}
                  {v.blocking > 0 && <div className="text-xs text-red-700">{v.blocking} blocking</div>}
                  {v.warnings > 0 && <div className="text-xs text-amber-700">{v.warnings} warnings</div>}
                </TableCell>
                <TableCell>{v.reviewerScenarios ? `${v.reviewerScenarios.passed}/${v.reviewerScenarios.total}` : <span className="text-slate-400">—</span>}</TableCell>
                <TableCell className="font-mono text-xs text-slate-600">{shortHash(v.bundleHash, 12)}</TableCell>
                <TableCell className="text-xs text-slate-500">{formatDateTime(v.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  );
}
