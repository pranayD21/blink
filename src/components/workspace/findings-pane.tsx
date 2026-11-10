"use client";

import { ChevronRight, Sparkles, UserRound } from "lucide-react";
import { useState } from "react";
import { Chip, StateChip } from "@/components/app/status-chip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView, FindingView, WorkspacePayload } from "@/server/services/workspace";
import { type Selection, isOpen } from "./model";

const SEVERITY_TONE: Record<string, string> = { high: "text-red-700", medium: "text-amber-700", low: "text-slate-500" };

function FindingRow({ finding, selected, onSelect }: { finding: FindingView; selected: boolean; onSelect: () => void }) {
  const escalation = finding.escalationRequired || finding.state === "ESCALATED";
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`finding-${finding.label}`}
      data-state={finding.state}
      className={cn("flex w-full items-start gap-2 border-l-2 border-transparent px-3 py-2.5 text-left hover:bg-slate-50", selected && "border-indigo-600 bg-indigo-50/60 hover:bg-indigo-50/60")}
    >
      <ChevronRight className={cn("mt-0.5 size-3.5 shrink-0 text-slate-300", selected && "rotate-90 text-indigo-600")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-semibold text-slate-900">{finding.label}</span>
          <StateChip state={finding.state} />
          {escalation && isOpen(finding) && <Chip tone="violet">escalation</Chip>}
        </div>
        <div className="mt-1 truncate text-sm text-slate-800">{finding.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          <span className={cn("font-medium capitalize", SEVERITY_TONE[finding.severity])}>{finding.severity}</span>
          {finding.rules.length > 0 && <span className="font-mono">{finding.rules.map((r) => r.ruleId).join(",")}</span>}
          {finding.turnLabels.length > 0 && <span>{finding.turnLabels.length > 1 ? `${finding.turnLabels.length} turns (${finding.turnLabels.join(", ")})` : finding.turnLabels[0]}</span>}
          {finding.origin === "reviewer" && (
            <span className="inline-flex items-center gap-1">
              <UserRound className="size-3" /> reviewer
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export function FindingsPane({ payload, selection, onSelect, view, onViewChange }: { payload: WorkspacePayload; selection: Selection; onSelect: (s: Selection) => void; view: "findings" | "claims"; onViewChange: (v: "findings" | "claims") => void }) {
  const [filter, setFilter] = useState("all");
  const matches = (f: FindingView) => filter === "all" || (filter === "open" ? isOpen(f) : f.state === filter);
  const main = payload.findings.filter((f) => f.origin !== "ai_suggested").filter(matches);
  const ai = payload.findings.filter((f) => f.origin === "ai_suggested").filter(matches);
  const selectedId = selection?.kind === "finding" ? selection.id : null;
  const selectedClaim = selection?.kind === "claim" ? selection.key : null;
  const states = [...new Set(payload.findings.map((f) => f.state))];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        {(["findings", "claims"] as const).map((v) => (
          <button key={v} type="button" onClick={() => onViewChange(v)} data-testid={`tab-${v}`} className={cn("rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100", view === v && "bg-slate-100 text-slate-900")}>
            {v === "findings" ? `Findings (${payload.findings.length})` : `All claims (${payload.claims.filter((c) => c.status !== "rejected").length})`}
          </button>
        ))}
        {view === "findings" && (
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger size="sm" className="ml-auto h-6 gap-1 border-none px-1.5 text-xs text-slate-500 shadow-none" aria-label="Filter findings">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="open">Open only</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="findings-pane">
        {view === "findings" ? (
          <>
            {payload.findings.length === 0 && (
              <p className="p-4 text-sm text-slate-500">{payload.policy ? "No findings. The whole-call attestation is still required: extraction can miss a statement, and a person has to read the call." : "Nothing was evaluated: no policy is active."}</p>
            )}
            <div className="divide-y divide-slate-100">
              {main.map((f) => (
                <FindingRow key={f.id} finding={f} selected={f.id === selectedId} onSelect={() => onSelect({ kind: "finding", id: f.id })} />
              ))}
            </div>
            {ai.length > 0 && (
              <div className="border-t">
                <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600" data-testid="ai-suggested-header">
                  <Sparkles className="size-3.5 text-indigo-500" />
                  AI-suggested ({ai.length})
                  <span className="font-normal text-slate-400">outside the compiled policy; a reviewer decides</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {ai.map((f) => (
                    <FindingRow key={f.id} finding={f} selected={f.id === selectedId} onSelect={() => onSelect({ kind: "finding", id: f.id })} />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <ClaimList claims={payload.claims} findings={payload.findings} selectedKey={selectedClaim} onSelect={(key) => onSelect({ kind: "claim", key })} />
        )}
      </div>
    </div>
  );
}

function ClaimList({ claims, findings, selectedKey, onSelect }: { claims: ClaimView[]; findings: FindingView[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  return (
    <div className="divide-y divide-slate-100">
      {claims
        .filter((c) => c.status !== "rejected")
        .map((c) => {
          const mine = findings.filter((f) => f.claimLogicalKey === c.logicalKey);
          return (
            <button key={c.id} type="button" onClick={() => onSelect(c.logicalKey)} data-testid={`claim-${c.logicalKey}`} className={cn("block w-full border-l-2 border-transparent px-3 py-2 text-left hover:bg-slate-50", selectedKey === c.logicalKey && "border-indigo-600 bg-indigo-50/60")}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-mono font-semibold text-slate-900">{c.logicalKey}</span>
                <span className="font-mono text-slate-400">{c.turnLabels.join("+")}</span>
                {c.comparison && <Chip tone={c.comparison.outcome === "exact_match" ? "emerald" : "slate"}>public: {c.comparison.outcome.replaceAll("_", " ")}</Chip>}
                {mine.map((f) => (
                  <StateChip key={f.id} state={f.state} title={f.label} />
                ))}
                {c.status === "reviewer_corrected" && <Chip tone="indigo">corrected</Chip>}
              </div>
              <div className="mt-1 line-clamp-2 text-sm text-slate-700">{c.fields.summary}</div>
            </button>
          );
        })}
      <p className="px-3 py-2 text-xs text-slate-400">{plural(claims.filter((c) => c.status !== "rejected").length, "claim")} extracted. Every quote was checked character for character against the transcript.</p>
    </div>
  );
}
