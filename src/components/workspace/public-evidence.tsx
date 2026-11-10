"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CandidateComparison } from "@/core/evidence/compare";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView } from "@/server/services/workspace";

const VERDICT: Record<string, { mark: string; className: string; label: string }> = {
  match: { mark: "✓", className: "text-emerald-700", label: "match" },
  mismatch: { mark: "✗", className: "text-red-700", label: "mismatch" },
  unknown: { mark: "?", className: "text-amber-700", label: "unknown" },
};

const DIMENSION_LABEL: Record<string, string> = { entity: "Company", metric: "Metric", period: "Period", scope: "Scope", value: "Value", published_before_call: "Published before the call" };

const OUTCOME: Record<string, { label: string; tone: "emerald" | "amber" | "red" | "slate" }> = {
  exact_match: { label: "exact match", tone: "emerald" },
  partial_match: { label: "partial match", tone: "amber" },
  mismatch_only: { label: "mismatch", tone: "red" },
  no_candidates: { label: "no candidate found", tone: "slate" },
};

function Candidate({ c }: { c: CandidateComparison }) {
  return (
    <div className="rounded-lg border bg-white" data-testid={`candidate-${c.documentId}`}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-medium text-slate-900">{c.documentTitle}</span>
        <span className="text-slate-500">published {formatDate(c.publishedAt)}</span>
        <Chip tone={c.classification === "exact" ? "emerald" : c.classification === "partial" ? "amber" : "red"} className="ml-auto">
          {c.classification}
        </Chip>
      </div>
      <p className="border-b px-3 py-1.5 text-xs text-slate-600 italic">“{c.factQuote}”</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="px-3 py-1 font-medium">Dimension</th>
            <th className="px-2 py-1 font-medium">Expert said</th>
            <th className="px-2 py-1 font-medium">Document says</th>
            <th className="px-3 py-1 font-medium" />
          </tr>
        </thead>
        <tbody>
          {c.dimensions.map((d) => {
            const v = VERDICT[d.verdict];
            return (
              <tr key={d.dimension} className="border-t border-slate-100 align-top" data-testid={`dimension-${d.dimension}`} data-verdict={d.verdict}>
                <td className="px-3 py-1 text-slate-600">{DIMENSION_LABEL[d.dimension] ?? d.dimension}</td>
                <td className="px-2 py-1 text-slate-800">{d.claim}</td>
                <td className="px-2 py-1 text-slate-800">{d.document}</td>
                <td className={cn("px-3 py-1 font-medium whitespace-nowrap", v.className)}>
                  {v.mark} {v.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The dimension-by-dimension comparison with curated public documents (§11.2). */
export function PublicEvidence({ claim, refresh }: { claim: ClaimView; refresh: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const comparison = claim.comparison;

  async function rule(verdict: "verified" | "rejected" | "clear") {
    setBusy(true);
    try {
      await api(`/api/claims/${claim.id}/public-match`, { body: { verdict, note, documentId: comparison?.best?.documentId ?? null, factId: comparison?.best?.factId ?? null, expectedVersion: claim.versionNo } });
      setNote("");
      toast.success(verdict === "clear" ? "Ruling withdrawn; the monitors were re-run." : `Public source ${verdict}; the monitors were re-run.`);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!comparison) {
    return <p className="text-sm text-slate-500">Not compared: only company-specific statements about the covered issuer are looked up in public documents.</p>;
  }
  const outcome = OUTCOME[comparison.outcome];
  const others = comparison.candidates.filter((c) => c !== comparison.best && c.factId !== comparison.best?.factId);

  return (
    <div className="space-y-2" data-testid="public-evidence" data-outcome={comparison.outcome}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Chip tone={outcome.tone} className="font-semibold" data-testid="comparison-outcome">
          {outcome.label}
        </Chip>
        {comparison.reasons.length > 0 && (
          <span className="text-xs text-slate-600" data-testid="mismatch-reasons">
            differs on: <span className="font-medium text-red-700">{comparison.reasons.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}</span>
          </span>
        )}
      </div>
      <p className="text-sm text-slate-700">{comparison.summary}</p>
      {comparison.best && <Candidate c={comparison.best} />}
      {others.length > 0 && (
        <>
          <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Hide" : "Show"} {others.length} other candidate{others.length === 1 ? "" : "s"}
          </button>
          {showAll && others.map((c) => <Candidate key={`${c.documentId}-${c.factId}`} c={c} />)}
        </>
      )}
      <p className="text-xs text-slate-500">
        {comparison.searchedDocuments} curated documents were searched. “Not found” means not found in this set. It never means the information is proven nonpublic.
      </p>

      {claim.reviewerMatch ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          <span>
            A reviewer {claim.reviewerMatch.verdict} a public source{claim.reviewerMatch.note ? `: ${claim.reviewerMatch.note}` : "."}
          </span>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => rule("clear")}>
            Withdraw
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note on the public source you checked (optional)" className="h-7 text-xs" />
          <Button size="xs" variant="outline" disabled={busy} onClick={() => rule("verified")} title="Compliance verifies the public source (policy P5)">
            Verify source
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => rule("rejected")}>
            Reject match
          </Button>
        </div>
      )}
    </div>
  );
}
