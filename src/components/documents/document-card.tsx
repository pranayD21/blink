"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { StatusDot } from "@/components/app/status-dot";
import { Checkbox } from "@/components/ui/checkbox";
import { api, errorMessage } from "@/lib/api";
import { formatDate, humanize, shortHash } from "@/lib/format";
import type { listDocuments } from "@/server/services/documents";

type Doc = ReturnType<typeof listDocuments>[number];

const valueText = (v: Doc["facts"][number]["value"]) => (v ? [v.direction, v.number !== null && v.number !== undefined ? `${v.number.toLocaleString("en-US")}${v.unit === "percent" ? "%" : v.unit ? ` ${v.unit}` : ""}` : null].filter(Boolean).join(" ") || "—" : "—");

/** One curated public document with the facts extracted from it (§11.1). */
export function DocumentCard({ doc }: { doc: Doc }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle(factId: string, verified: boolean) {
    setBusy(factId);
    try {
      const res = await api<{ affectedCases: string[] }>(`/api/documents/${doc.id}/verify`, { body: { factId, verified, expectedVersion: doc.version } });
      toast.success(`${factId} ${verified ? "verified" : "unverified"}.${res.affectedCases.length > 0 ? ` ${res.affectedCases.length} case(s) re-checked.` : ""}`);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="rounded-xl border bg-card" data-testid={`document-${doc.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{doc.title}</h2>
        <span className="text-xs text-muted-foreground">{humanize(doc.sourceType).toLowerCase()}</span>
        <span className="text-xs text-muted-foreground">
          {doc.issuer} · published {formatDate(doc.publishedAt)}
        </span>
        <span className="ml-auto font-mono text-xs text-muted-foreground" title="Hash of the document body and its facts. Decisions that compared a claim against this document depend on it.">
          {shortHash(doc.hash, 10)}
        </span>
      </header>
      {doc.factsStatus !== "extracted" ? (
        <p className="px-4 py-3 text-sm"><StatusDot tone={doc.factsStatus === "failed" ? "stop" : "warn"}>{doc.factsStatus === "failed" ? "Fact extraction failed for this document." : "Facts have not been extracted yet. The worker does this in the background."}</StatusDot></p>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-muted text-left text-muted-foreground">
            <tr>
              {["Fact", "About", "Metric / event", "Period", "Scope", "Value", "Quote from the document", "Verified"].map((h) => (
                <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.facts.map((f) => (
              <tr key={f.fact_id} className="border-t border-border align-top">
                <td className="px-3 py-1.5 font-mono font-semibold text-foreground">{f.fact_id}</td>
                <td className="px-3 py-1.5 text-foreground">{f.entity}</td>
                <td className="px-3 py-1.5 text-foreground">{f.metric_category ? humanize(f.metric_category) : humanize(f.event_kind)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-foreground">{f.period ? `${f.period.q ? `Q${f.period.q} ` : ""}FY${f.period.fy}` : "—"}</td>
                <td className="px-3 py-1.5 text-foreground">{humanize(f.scope)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-foreground">{valueText(f.value)}</td>
                <td className="px-3 py-1.5 text-muted-foreground italic">“{f.quote}”</td>
                <td className="px-3 py-1.5">
                  <Checkbox checked={Boolean(f.verified)} disabled={busy !== null} onCheckedChange={(v) => toggle(f.fact_id, v === true)} aria-label={`Verify ${f.fact_id}`} data-testid={`verify-${doc.id}-${f.fact_id}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t px-4 py-2">
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} document text
        </button>
        {open && <pre className="mt-2 max-h-64 overflow-y-auto rounded-md bg-muted p-3 font-sans text-xs whitespace-pre-wrap text-foreground">{doc.body}</pre>}
      </div>
    </article>
  );
}
