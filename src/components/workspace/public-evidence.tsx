"use client";

import { useState } from "react";
import { toast } from "sonner";
import { type DotTone, StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CandidateComparison } from "@/core/evidence/compare";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView } from "@/server/services/workspace";

const VERDICT: Record<string, { mark: string; className: string; label: string }> = {
  match: { mark: "✓", className: "text-success", label: "match" },
  mismatch: { mark: "✗", className: "text-destructive", label: "mismatch" },
  unknown: { mark: "?", className: "text-warning", label: "unknown" },
};

const DIMENSION_LABEL: Record<string, string> = { entity: "Company", metric: "Metric", period: "Period", scope: "Scope", value: "Value", published_before_call: "Published before the call" };

const OUTCOME: Record<string, { label: string; tone: DotTone }> = {
  exact_match: { label: "exact match", tone: "good" },
  partial_match: { label: "proposed match — verify", tone: "warn" },
  mismatch_only: { label: "mismatch", tone: "stop" },
  no_candidates: { label: "no match", tone: "none" },
};

function Candidate({ c }: { c: CandidateComparison }) {
  return (
    <div className="rounded-lg border bg-card" data-testid={`candidate-${c.documentId}`}>
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs">
        <span className="font-medium text-foreground">{c.documentTitle}</span>
        <span className="text-muted-foreground">published {formatDate(c.publishedAt)}</span>
        <StatusDot tone={c.classification === "exact" ? "good" : c.classification === "partial" ? "warn" : "stop"} className="ml-auto">
          {c.classification}
        </StatusDot>
      </div>
      <p className="border-b px-3 py-1.5 text-xs text-muted-foreground italic">“{c.factQuote}”</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
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
              <tr key={d.dimension} className="border-t align-top" data-testid={`dimension-${d.dimension}`} data-verdict={d.verdict}>
                <td className="px-3 py-1 text-muted-foreground">{DIMENSION_LABEL[d.dimension] ?? d.dimension}</td>
                <td className="px-2 py-1 text-foreground">{d.claim}</td>
                <td className="px-2 py-1 text-foreground">{d.document}</td>
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
    return <p className="text-sm text-muted-foreground">Not compared: only company-specific statements about the covered issuer are looked up in public documents.</p>;
  }
  const outcome = OUTCOME[comparison.outcome];
  const others = comparison.candidates.filter((c) => c !== comparison.best && c.factId !== comparison.best?.factId);

  return (
    <div className="space-y-2" data-testid="public-evidence" data-outcome={comparison.outcome}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusDot tone={outcome.tone} className="font-medium" data-testid="comparison-outcome">
          {outcome.label}
        </StatusDot>
        {comparison.reasons.length > 0 && (
          <span className="text-xs text-muted-foreground" data-testid="mismatch-reasons">
            differs on: <span className="font-medium text-foreground">{comparison.reasons.map((r) => r.replaceAll("_", " ").toLowerCase()).join(", ")}</span>
          </span>
        )}
      </div>
      <p className="text-sm text-foreground">{comparison.summary}</p>
      {comparison.best && <Candidate c={comparison.best} />}
      {others.length > 0 && (
        <>
          <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Hide" : "Show"} {others.length} other candidate{others.length === 1 ? "" : "s"}
          </button>
          {showAll && others.map((c) => <Candidate key={`${c.documentId}-${c.factId}`} c={c} />)}
        </>
      )}
      <p className="text-xs text-muted-foreground" data-testid="searched-note">
        {comparison.outcome === "no_candidates" ? `No match in the ${comparison.searchedDocuments} searched documents (not proof of nonpublic status).` : `${comparison.searchedDocuments} curated documents were searched.`} “Not found” means not found in this set. It never means the information is proven nonpublic.
      </p>

      {claim.reviewerMatch ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted px-3 py-2 text-xs text-foreground">
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
