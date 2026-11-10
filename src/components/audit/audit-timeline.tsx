"use client";

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, humanize, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditEventView } from "@/server/audit/log";

type Verification = { ok: true; count: number; headHash: string } | { ok: false; count: number; brokenSeq: number; reason: string };

const TONE: Record<string, string> = {
  STALE_DEPENDENCY: "border-red-300 bg-red-50",
  BRIEF_STALE: "border-red-300 bg-red-50",
  RELEASE_BLOCKED: "border-red-300 bg-red-50",
  ANALYSIS_FAILED: "border-red-300 bg-red-50",
  BRIEF_RELEASED: "border-emerald-300 bg-emerald-50",
  BRIEF_APPROVED: "border-emerald-300 bg-emerald-50",
  FINDING_DISPOSITIONED: "border-emerald-300 bg-emerald-50",
  CASE_ATTESTED: "border-emerald-300 bg-emerald-50",
  FINDING_ESCALATED: "border-violet-300 bg-violet-50",
};

function summarize(e: AuditEventView): string {
  const p = e.payload;
  switch (e.type) {
    case "CASE_STATUS_CHANGED":
      return `${p.from} → ${p.to} (${p.cause})`;
    case "FINDING_CREATED":
      return `${p.label ?? ""} opened: ${p.title ?? ""}`;
    case "FINDING_STATE_CHANGED":
      return `${p.label ?? ""} ${p.from} → ${p.to}${p.cause ? ` (${p.cause})` : ""}`;
    case "FINDING_DISPOSITIONED":
      return `${p.label} dispositioned ${p.outcome} by a ${String(p.decided_by_role).replaceAll("_", " ")}: ${p.rationale}`;
    case "FINDING_ESCALATED":
      return `${p.label} escalated: ${p.rationale}`;
    case "STALE_DEPENDENCY":
      return `${p.dependent} went stale: ${p.reason}`;
    case "BRIEF_STALE":
      return `brief v${p.version} is stale: ${p.reason}`;
    case "RELEASE_BLOCKED":
      return `release of brief v${p.version} blocked: ${(p.failures as { message: string }[]).map((f) => f.message).join("; ")}`;
    case "BRIEF_RELEASED":
      return `brief v${p.version} released to ${p.audience}, hash ${shortHash(String(p.brief_hash), 12)}`;
    case "BRIEF_APPROVED":
      return `brief v${p.version} approved for ${p.audience}, hash ${shortHash(String(p.brief_hash), 12)}`;
    case "BRIEF_DRAFTED":
      return `brief v${p.version} drafted (${p.source}): ${p.sentences} sentences citing ${(p.cited_claims as string[]).length} claims, ${p.withheld} withheld`;
    case "TRANSCRIPT_UPLOADED":
      return `transcript v${p.version} uploaded (${p.turns} turns)${(p.changes as { edited: string[] })?.edited?.length ? `; edited: ${(p.changes as { edited: string[] }).edited.join(", ")}` : ""}`;
    case "ANALYSIS_COMPLETED":
      return `analysis finished: ${(p.quotes as { valid: number; proposed: number }).valid}/${(p.quotes as { valid: number; proposed: number }).proposed} quotes valid, ${p.findings_opened} findings opened`;
    case "CLAIM_CORRECTED":
      return `${p.claim} corrected (${Object.keys(p.fields as object).join(", ")}) via ${p.source}`;
    case "CLARIFICATION_ANSWERED":
      return `clarification on ${p.finding}: ${p.answer}`;
    case "CASE_ATTESTED":
      return `whole-call attestation for transcript v${p.transcript_version} (${p.turns} turns)`;
    case "PUBLIC_EVIDENCE_COMPARED":
      return `${p.claim}: ${String(p.outcome).replaceAll("_", " ")}${(p.reasons as string[]).length ? ` (${(p.reasons as string[]).join(", ")})` : ""}`;
    case "CASE_REEVALUATED":
      return `re-evaluated (${p.reason}): ${p.claims} claims, ${p.findings_opened} findings opened`;
    case "TASK_OPENED":
      return `${p.kind} task opened: ${p.question ?? ""}`;
    case "TASK_CLOSED":
      return `${p.kind} task ${p.status}${p.reason ? `: ${p.reason}` : ""}`;
    default:
      return Object.entries(p)
        .filter(([, v]) => typeof v === "string" || typeof v === "number")
        .slice(0, 4)
        .map(([k, v]) => `${k.replaceAll("_", " ")}: ${v}`)
        .join(" · ");
  }
}

export function AuditTimeline({ events, users, scope }: { events: AuditEventView[]; users: Record<string, string>; scope: string }) {
  const [result, setResult] = useState<Verification | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<Verification>("/api/audit/verify", { body: {} }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white px-4 py-3">
        <Button size="sm" onClick={verify} disabled={busy} data-testid="verify-chain">
          <ShieldCheck /> {busy ? "Verifying…" : "Verify chain"}
        </Button>
        {result?.ok && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-emerald-700" data-testid="verify-ok">
            <CheckCircle2 className="size-4" /> Verify chain ✓ {result.count} events recomputed, head {shortHash(result.headHash, 12)}
          </span>
        )}
        {result && !result.ok && (
          <span className="flex items-center gap-1.5 text-sm font-medium text-red-700" data-testid="verify-broken">
            <XCircle className="size-4" /> Chain broken at event #{result.brokenSeq}: {result.reason}
          </span>
        )}
        {error && <span className="text-sm text-red-700">{error}</span>}
        <span className="ml-auto text-xs text-slate-500">
          {events.length} events for {scope}. Each event stores the hash of the one before it; editing or deleting any row breaks the chain from that point.
        </span>
      </div>

      <ol className="space-y-1.5" data-testid="audit-events">
        {events.map((e) => (
          <li key={e.id} className={cn("rounded-lg border-l-4 border-slate-200 bg-white px-3 py-2 text-sm", TONE[e.type], result && !result.ok && result.brokenSeq === e.seq && "ring-2 ring-red-500")} data-type={e.type}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="font-mono text-xs text-slate-400">#{e.seq}</span>
              <span className="font-medium text-slate-900">{humanize(e.type)}</span>
              <span className="text-xs text-slate-500">{e.actorId === "system" ? "Blink (system)" : (users[e.actorId] ?? e.actorId)}</span>
              <span className="text-xs text-slate-400">{formatDateTime(e.ts)}</span>
              <span className="ml-auto font-mono text-[11px] text-slate-400" title={`hash ${e.hash}\nprev ${e.prevHash}`}>
                {shortHash(e.prevHash, 8)} → {shortHash(e.hash, 8)}
              </span>
            </div>
            <p className="mt-0.5 text-slate-700">{summarize(e)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
