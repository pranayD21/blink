"use client";

import { Pencil } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ACCESS_TIMINGS, ENTITY_KINDS, EVENT_KINDS, KNOWLEDGE_BASES, SCOPES } from "@/core/types";
import type { ClaimFields } from "@/core/types";
import { api, errorMessage } from "@/lib/api";
import { humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView } from "@/server/services/workspace";
import { buildClaimCorrection, type CorrectionDraft } from "./claim-correction";

/** One row: how the field reads, and the choices for a simple enum. Period and value have their own editors. */
interface Row {
  field: keyof ClaimFields;
  label: string;
  show: (f: ClaimFields) => string;
  options?: readonly string[];
  read?: (f: ClaimFields) => string;
}

const controlClass = "h-6 rounded border border-input bg-background px-1 text-xs";

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
  { field: "subject_entity", label: "Company", show: (f) => `${f.subject_entity.name ?? "not named"} (${f.subject_entity.kind})`, options: ENTITY_KINDS, read: (f) => f.subject_entity.kind },
  { field: "metric", label: "Metric", show: (f) => (f.metric ? `${f.metric.label} (${f.metric.category})` : "none") },
  { field: "event_kind", label: "Event", show: (f) => humanize(f.event_kind), options: EVENT_KINDS, read: (f) => f.event_kind },
  { field: "period", label: "Period", show: period, read: (f) => f.period.relative },
  { field: "value", label: "Value", show: value },
  { field: "scope", label: "Scope", show: (f) => `${humanize(f.scope)}${f.scope_detail ? ` — ${f.scope_detail}` : ""}`, options: SCOPES, read: (f) => f.scope },
  { field: "knowledge_basis", label: "Source", show: (f) => humanize(f.knowledge_basis), options: KNOWLEDGE_BASES, read: (f) => f.knowledge_basis },
  { field: "access_timing", label: "Access timing", show: (f) => humanize(f.access_timing), options: ACCESS_TIMINGS, read: (f) => f.access_timing },
  { field: "confidentiality_signals", label: "Confidentiality signals", show: (f) => (f.confidentiality_signals.length > 0 ? f.confidentiality_signals.map((s) => `“${s}”`).join(", ") : "none") },
];

/**
 * What the expert was recorded as saying (asserted) beside what a reviewer has
 * verified. A correction never overwrites the asserted value; it creates a new
 * claim version, and the monitors re-run on `verified ?? asserted` (§10.6).
 */
export function ClaimFieldsEditor({ claim, refresh }: { claim: ClaimView; refresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CorrectionDraft>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verified = claim.verified ?? {};

  async function save() {
    const built = buildClaimCorrection(claim.fields, claim.asserted, claim.verified, draft);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    if (Object.keys(built.verified).length === 0 && built.clear.length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/claims/${claim.id}`, { method: "PATCH", body: { verified: built.verified, clear: built.clear, note, expectedVersion: claim.versionNo } });
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
          <tr className="text-left text-muted-foreground">
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
              <tr key={row.field} className="border-t align-top" data-testid={`field-${row.field}`}>
                <td className="py-1 pr-2 text-muted-foreground">{row.label}</td>
                <td className={cn("py-1 pr-2 text-foreground", isVerified && "text-muted-foreground line-through decoration-muted-foreground/50")}>{row.show(claim.asserted)}</td>
                <td className="py-1">
                  {editing && row.field === "period" ? (
                    <PeriodEditor fields={claim.fields} draft={draft} setDraft={setDraft} canRevert={isVerified} />
                  ) : editing && row.field === "value" ? (
                    <ValueEditor fields={claim.fields} draft={draft} setDraft={setDraft} canRevert={isVerified} />
                  ) : editing && row.options ? (
                    <select value={current} onChange={(e) => setDraft((d) => ({ ...d, [row.field]: e.target.value }))} className={`${controlClass} w-full`} data-testid={`edit-${row.field}`}>
                      {row.options.map((o) => (
                        <option key={o} value={o}>
                          {humanize(o)}
                        </option>
                      ))}
                      {isVerified && <option value="__asserted__">↩ back to what the expert said</option>}
                    </select>
                  ) : isVerified ? (
                    <span className="font-medium text-foreground" data-testid={`verified-${row.field}`}>
                      {row.show(claim.fields)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {claim.meta.ungroundedFields.length > 0 && <StatusDot tone="warn" className="mt-1 items-start text-xs whitespace-normal [&>span:first-child]:mt-1">Reset to “unknown” because no expert quote supports them: {claim.meta.ungroundedFields.join(", ")}.</StatusDot>}
      {editing ? (
        <div className="mt-2 space-y-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why are you correcting this? (kept in the audit log)" className="h-7 text-xs" />
          {error && <p className="text-xs text-destructive">{error}</p>}
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
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
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

const RELATIVE = ["current", "prior", "future", "unspecified"] as const;
const UNITS = ["percent", "usd", "units"] as const;
const DIRECTIONS = ["up", "down", "flat"] as const;

function PeriodEditor({ fields, draft, setDraft, canRevert }: { fields: ClaimFields; draft: CorrectionDraft; setDraft: Dispatch<SetStateAction<CorrectionDraft>>; canRevert: boolean }) {
  const reverted = draft.period === "__asserted__";
  const relative = reverted ? fields.period.relative : (draft.period ?? fields.period.relative);
  const quarter = draft.fiscal_quarter ?? (fields.period.fiscal_quarter === null ? "" : String(fields.period.fiscal_quarter));
  const year = draft.fiscal_year ?? (fields.period.fiscal_year === null ? "" : String(fields.period.fiscal_year));
  return (
    <div className="flex flex-col gap-1">
      <select value={reverted ? "__asserted__" : relative} onChange={(e) => setDraft((d) => ({ ...d, period: e.target.value }))} className={`${controlClass} w-full`} data-testid="edit-period">
        {RELATIVE.map((o) => (
          <option key={o} value={o}>
            {humanize(o)}
          </option>
        ))}
        {canRevert && <option value="__asserted__">↩ back to what the expert said</option>}
      </select>
      {!reverted && (
        <div className="flex gap-1">
          <select value={quarter} onChange={(e) => setDraft((d) => ({ ...d, fiscal_quarter: e.target.value }))} className={`${controlClass} min-w-0 flex-1`} data-testid="edit-fiscal-quarter" aria-label="Fiscal quarter">
            <option value="">Quarter not stated</option>
            <option value="1">Q1</option>
            <option value="2">Q2</option>
            <option value="3">Q3</option>
            <option value="4">Q4</option>
          </select>
          <input value={year} onChange={(e) => setDraft((d) => ({ ...d, fiscal_year: e.target.value }))} inputMode="numeric" placeholder="Year" aria-label="Fiscal year" className={`${controlClass} w-16`} data-testid="edit-fiscal-year" />
        </div>
      )}
    </div>
  );
}

function ValueEditor({ fields, draft, setDraft, canRevert }: { fields: ClaimFields; draft: CorrectionDraft; setDraft: Dispatch<SetStateAction<CorrectionDraft>>; canRevert: boolean }) {
  if (draft.value === "__asserted__") {
    return (
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setDraft((d) => ({ ...d, value: "" }))}>
        Back to what the expert said. Undo.
      </button>
    );
  }
  const number = draft.value_number ?? (fields.value?.number === null || fields.value?.number === undefined ? "" : String(fields.value.number));
  const unit = draft.value_unit ?? fields.value?.unit ?? "";
  const direction = draft.value_direction ?? fields.value?.direction ?? "";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <select value={direction} onChange={(e) => setDraft((d) => ({ ...d, value_direction: e.target.value }))} className={`${controlClass} min-w-0 flex-1`} data-testid="edit-value-direction" aria-label="Direction">
          <option value="">No direction</option>
          {DIRECTIONS.map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </select>
        <input value={number} onChange={(e) => setDraft((d) => ({ ...d, value_number: e.target.value }))} inputMode="decimal" placeholder="Number" aria-label="Figure" className={`${controlClass} w-16`} data-testid="edit-value-number" />
        <select value={unit} onChange={(e) => setDraft((d) => ({ ...d, value_unit: e.target.value }))} className={`${controlClass} min-w-0 flex-1`} data-testid="edit-value-unit" aria-label="Unit">
          <option value="">No unit</option>
          {UNITS.map((o) => (
            <option key={o} value={o}>
              {humanize(o)}
            </option>
          ))}
        </select>
      </div>
      {fields.value?.baseline && <span className="text-muted-foreground">Baseline stays “{fields.value.baseline}”.</span>}
      {canRevert && (
        <button type="button" className="self-start text-muted-foreground underline" data-testid="revert-value" onClick={() => setDraft((d) => ({ ...d, value: "__asserted__" }))}>
          Back to what the expert said
        </button>
      )}
    </div>
  );
}
