"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCESS_TIMINGS, ENTITY_KINDS, EVENT_KINDS, KNOWLEDGE_BASES, SCOPES } from "@/core/types";
import type { ClaimFields } from "@/core/types";
import { api, errorMessage } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView } from "@/server/services/workspace";

type Verified = Partial<ClaimFields>;

/** One editable row: how the field reads, and how a new value is written back. */
interface Row {
  field: keyof ClaimFields;
  label: string;
  show: (f: ClaimFields) => string;
  options?: readonly string[];
  read?: (f: ClaimFields) => string;
  write?: (f: ClaimFields, v: string) => Verified;
}

const period = (f: ClaimFields) => {
  const p = f.period;
  const parts = [p.fiscal_quarter ? `Q${p.fiscal_quarter}${p.fiscal_year ? ` FY${p.fiscal_year}` : ""}` : p.fiscal_year ? `FY${p.fiscal_year}` : null, p.calendar_quarter ? `calendar Q${p.calendar_quarter}${p.calendar_year ? ` ${p.calendar_year}` : ""}` : null, p.relative !== "unspecified" ? p.relative : null, p.label ? `“${p.label}”` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "not stated";
};
const value = (f: ClaimFields) => {
  const v = f.value;
  if (!v) return "not stated";
  return [v.direction, v.number !== null ? `${v.number}${v.unit === "percent" ? "%" : v.unit ? ` ${v.unit}` : ""}` : null, v.baseline].filter(Boolean).join(" ") || "not stated";
};

const ROWS: Row[] = [
  { field: "subject_entity", label: "Company", show: (f) => `${f.subject_entity.name ?? "not named"} (${f.subject_entity.kind})`, options: ENTITY_KINDS, read: (f) => f.subject_entity.kind, write: (f, v) => ({ subject_entity: { name: f.subject_entity.name, kind: v as ClaimFields["subject_entity"]["kind"] } }) },
  { field: "metric", label: "Metric", show: (f) => (f.metric ? `${f.metric.label} (${f.metric.category})` : "none") },
  { field: "event_kind", label: "Event", show: (f) => humanize(f.event_kind), options: EVENT_KINDS, read: (f) => f.event_kind, write: (_f, v) => ({ event_kind: v as ClaimFields["event_kind"] }) },
  { field: "period", label: "Period", show: period, options: ["current", "prior", "future", "unspecified"], read: (f) => f.period.relative, write: (f, v) => ({ period: { ...f.period, relative: v as ClaimFields["period"]["relative"] } }) },
  { field: "value", label: "Value", show: value },
  { field: "scope", label: "Scope", show: (f) => `${humanize(f.scope)}${f.scope_detail ? ` — ${f.scope_detail}` : ""}`, options: SCOPES, read: (f) => f.scope, write: (_f, v) => ({ scope: v as ClaimFields["scope"] }) },
  { field: "knowledge_basis", label: "Source", show: (f) => humanize(f.knowledge_basis), options: KNOWLEDGE_BASES, read: (f) => f.knowledge_basis, write: (_f, v) => ({ knowledge_basis: v as ClaimFields["knowledge_basis"] }) },
  { field: "access_timing", label: "Access timing", show: (f) => humanize(f.access_timing), options: ACCESS_TIMINGS, read: (f) => f.access_timing, write: (_f, v) => ({ access_timing: v as ClaimFields["access_timing"] }) },
  { field: "confidentiality_signals", label: "Confidentiality signals", show: (f) => (f.confidentiality_signals.length > 0 ? f.confidentiality_signals.map((s) => `“${s}”`).join(", ") : "none") },
];

/**
 * What the expert was recorded as saying (asserted) beside what a reviewer has
 * verified. A correction never overwrites the asserted value; it creates a new
 * claim version, and the monitors re-run on `verified ?? asserted` (§10.6).
 */
export function ClaimFieldsEditor({ claim, refresh }: { claim: ClaimView; refresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = claim.verified ?? {};

  async function save() {
    const patch: Verified = {};
    const clear: string[] = [];
    for (const row of ROWS) {
      const next = draft[row.field];
      if (next === undefined || !row.write || !row.read) continue;
      if (next === "__asserted__") {
        if (row.field in verified) clear.push(row.field);
      } else if (next !== row.read(claim.fields)) {
        Object.assign(patch, row.write(claim.fields, next));
      }
    }
    if (Object.keys(patch).length === 0 && clear.length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/claims/${claim.id}`, { method: "PATCH", body: { verified: patch, clear, note, expectedVersion: claim.versionNo } });
      toast.success(`${claim.logicalKey} corrected. The monitors were re-run.`);
      setEditing(false);
      setDraft({});
      setNote("");
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="claim-fields">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="w-[26%] py-1 font-medium">Field</th>
            <th className="w-[37%] py-1 font-medium">Expert asserted</th>
            <th className="py-1 font-medium">Reviewer verified</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            const isVerified = row.field in verified;
            const current = draft[row.field] ?? (row.read ? row.read(claim.fields) : "");
            return (
              <tr key={row.field} className="border-t border-slate-100 align-top" data-testid={`field-${row.field}`}>
                <td className="py-1 pr-2 text-slate-600">{row.label}</td>
                <td className={cn("py-1 pr-2 text-slate-800", isVerified && "text-slate-400 line-through decoration-slate-300")}>{row.show(claim.asserted)}</td>
                <td className="py-1">
                  {editing && row.options ? (
                    <select value={current} onChange={(e) => setDraft((d) => ({ ...d, [row.field]: e.target.value }))} className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-xs" data-testid={`edit-${row.field}`}>
                      {row.options.map((o) => (
                        <option key={o} value={o}>
                          {humanize(o)}
                        </option>
                      ))}
                      {isVerified && <option value="__asserted__">↩ back to what the expert said</option>}
                    </select>
                  ) : isVerified ? (
                    <span className="font-medium text-indigo-700" data-testid={`verified-${row.field}`}>
                      {row.show(claim.fields)}
                    </span>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {claim.meta.ungroundedFields.length > 0 && <p className="mt-1 text-xs text-amber-700">Reset to “unknown” because no expert quote supports them: {claim.meta.ungroundedFields.join(", ")}.</p>}
      {editing ? (
        <div className="mt-2 space-y-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why are you correcting this? (kept in the audit log)" className="h-7 text-xs" />
          {error && <p className="text-xs text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="xs" variant="ghost" onClick={() => (setEditing(false), setDraft({}), setError(null))}>
              Cancel
            </Button>
            <Button size="xs" disabled={busy} onClick={save} data-testid="save-correction">
              {busy ? "Saving…" : "Save correction"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            {claim.logicalKey} · version {claim.versionNo}
            {claim.status === "reviewer_corrected" ? " · reviewer-corrected" : ""}
          </span>
          <Button size="xs" variant="outline" onClick={() => setEditing(true)} data-testid="edit-claim">
            <Pencil /> Correct a field
          </Button>
        </div>
      )}
    </div>
  );
}
