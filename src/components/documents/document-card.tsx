"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Chip } from "@/components/app/status-chip";
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
    <article className="rounded-xl border bg-white" data-testid={`document-${doc.id}`}>
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">{doc.title}</h2>
        <Chip tone="slate">{humanize(doc.sourceType).toLowerCase()}</Chip>
        <span className="text-xs text-slate-500">
          {doc.issuer} · published {formatDate(doc.publishedAt)}
        </span>
        <span className="ml-auto font-mono text-xs text-slate-400" title="Hash of the document body and its facts. Decisions that compared a claim against this document depend on it.">
          {shortHash(doc.hash, 10)}
        </span>
      </header>
      {doc.factsStatus !== "extracted" ? (
        <p className="px-4 py-3 text-sm text-amber-800">{doc.factsStatus === "failed" ? "Fact extraction failed for this document." : "Facts have not been extracted yet. The worker does this in the background."}</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              {["Fact", "About", "Metric / event", "Period", "Scope", "Value", "Quote from the document", "Verified"].map((h) => (
                <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {doc.facts.map((f) => (
              <tr key={f.fact_id} className="border-t border-slate-100 align-top">
                <td className="px-3 py-1.5 font-mono font-semibold text-slate-700">{f.fact_id}</td>
                <td className="px-3 py-1.5 text-slate-800">{f.entity}</td>
                <td className="px-3 py-1.5 text-slate-800">{f.metric_category ? humanize(f.metric_category) : humanize(f.event_kind)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-slate-800">{f.period ? `${f.period.q ? `Q${f.period.q} ` : ""}FY${f.period.fy}` : "—"}</td>
                <td className="px-3 py-1.5 text-slate-800">{humanize(f.scope)}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-slate-800">{valueText(f.value)}</td>
                <td className="px-3 py-1.5 text-slate-600 italic">“{f.quote}”</td>
                <td className="px-3 py-1.5">
                  <Checkbox checked={Boolean(f.verified)} disabled={busy !== null} onCheckedChange={(v) => toggle(f.fact_id, v === true)} aria-label={`Verify ${f.fact_id}`} data-testid={`verify-${doc.id}-${f.fact_id}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="border-t px-4 py-2">
        <button type="button" className="text-xs text-indigo-700 hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"} document text
        </button>
        {open && <pre className="mt-2 max-h-64 overflow-y-auto rounded-md bg-slate-50 p-3 font-sans text-xs whitespace-pre-wrap text-slate-700">{doc.body}</pre>}
      </div>
    </article>
  );
}
