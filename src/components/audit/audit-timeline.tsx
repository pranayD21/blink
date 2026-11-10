"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { type DotTone, StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, humanize, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuditEventView } from "@/server/audit/log";

type Verification = { ok: true; count: number; headHash: string } | { ok: false; count: number; brokenSeq: number; reason: string };

/** The dot an event carries; anything not listed here is a plain event with a quiet dot. */
const DOT: Record<string, DotTone> = {
  STALE_DEPENDENCY: "stop",
  BRIEF_STALE: "stop",
  RELEASE_BLOCKED: "stop",
  ANALYSIS_FAILED: "stop",
  BRIEF_RELEASED: "good",
  BRIEF_APPROVED: "good",
  FINDING_DISPOSITIONED: "good",
  CASE_ATTESTED: "good",
  FINDING_ESCALATED: "ring",
};

const state = (v: unknown) => humanize(String(v));

function summarize(e: AuditEventView): string {
  const p = e.payload;
  switch (e.type) {
    case "CASE_STATUS_CHANGED":
      return `${state(p.from)} → ${state(p.to)} (${p.cause})`;
    case "FINDING_CREATED":
      return `${p.label ?? ""} opened: ${p.title ?? ""}`;
    case "FINDING_STATE_CHANGED":
      return `${p.label ?? ""} ${state(p.from)} → ${state(p.to)}${p.cause ? ` (${p.cause})` : ""}`;
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
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3">
        <Button size="sm" onClick={verify} disabled={busy} data-testid="verify-chain">
          <ShieldCheck /> {busy ? "Verifying…" : "Verify chain"}
        </Button>
        {result?.ok && (
          <StatusDot tone="good" className="text-sm font-medium text-foreground" data-testid="verify-ok">
            Verify chain ✓ {result.count} events recomputed, head <span className="font-mono">{shortHash(result.headHash, 12)}</span>
          </StatusDot>
        )}
        {result && !result.ok && (
          <StatusDot tone="stop" className="text-sm font-medium text-foreground" data-testid="verify-broken">
            Chain broken at event #{result.brokenSeq}: {result.reason}
          </StatusDot>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
        <span className="ml-auto text-xs text-muted-foreground">
          {events.length} events for {scope}. Each event stores the hash of the one before it; editing or deleting any row breaks the chain from that point.
        </span>
      </div>

      <ol className="divide-y rounded-xl border bg-card text-sm" data-testid="audit-events">
        {events.map((e) => (
          <li key={e.id} className={cn("flex items-baseline gap-3 px-4 py-2", result && !result.ok && result.brokenSeq === e.seq && "bg-destructive/10 ring-2 ring-destructive ring-inset")} data-type={e.type}>
            <span className="w-40 shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateTime(e.ts)}</span>
            <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">{e.actorId === "system" ? "Blink (system)" : (users[e.actorId] ?? e.actorId)}</span>
            <span className="min-w-0 flex-1 text-foreground">
              <StatusDot tone={DOT[e.type] ?? "none"} className="mr-2 align-baseline" />
              <span className="font-medium">{humanize(e.type)}</span> <span className="text-muted-foreground">{summarize(e)}</span>
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground" title={`#${e.seq}\nhash ${e.hash}\nprev ${e.prevHash}`}>
              {shortHash(e.hash, 8)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
