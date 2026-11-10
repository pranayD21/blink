"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { StateChip } from "@/components/app/status-chip";
import { StateLabel } from "@/components/app/status-dot";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { humanize, plural } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView, FindingView, WorkspacePayload } from "@/server/services/workspace";
import { type Selection, isOpen } from "./model";

/** The turns a finding rests on, as one short run: "T5", or "T5, T11". */
const turnsText = (f: FindingView) => f.turnLabels.join(", ");

/** One line per finding: label, state, title, turns. Severity, rules and who raised it wait in the tooltip. */
function FindingRow({ finding, selected, onSelect }: { finding: FindingView; selected: boolean; onSelect: () => void }) {
  const escalation = finding.escalationRequired || finding.state === "ESCALATED";
  const detail = [
    `${humanize(finding.severity)} severity`,
    finding.rules.length > 0 ? `rules ${finding.rules.map((r) => `${r.ruleId}${r.state === "NEEDS_CONTEXT" ? " (needs context)" : ""}`).join(", ")}` : null,
    escalation && isOpen(finding) ? "escalation" : null,
    finding.origin === "reviewer" ? "raised by a reviewer" : null,
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`finding-${finding.label}`}
      data-state={finding.state}
      title={`${finding.title} · ${detail.join(" · ")}`}
      className={cn("flex w-full items-center gap-2 border-l-2 border-transparent px-3 py-2 text-left text-sm hover:bg-muted", selected && "border-foreground bg-muted")}
    >
      <span className="w-7 shrink-0 font-mono text-xs font-medium text-foreground">{finding.label}</span>
      <StateLabel state={finding.state} className="shrink-0 text-xs text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-foreground">{finding.title}</span>
      {finding.turnLabels.length > 0 && <span className="shrink-0 font-mono text-xs text-muted-foreground">{turnsText(finding)}</span>}
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
          <button key={v} type="button" onClick={() => onViewChange(v)} data-testid={`tab-${v}`} className={cn("rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted", view === v && "bg-muted text-foreground")}>
            {v === "findings" ? `Findings (${payload.findings.length})` : `All claims (${payload.claims.filter((c) => c.status !== "rejected").length})`}
          </button>
        ))}
        {view === "findings" && (
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger size="sm" className="ml-auto h-6 gap-1 border-none px-1.5 text-xs text-muted-foreground shadow-none" aria-label="Filter findings">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="open">Open only</SelectItem>
              {states.map((s) => (
                <SelectItem key={s} value={s}>
                  {humanize(s)}
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
              <p className="p-4 text-sm text-muted-foreground">{payload.policy ? "No findings. The whole-call attestation is still required: extraction can miss a statement, and a person has to read the call." : "Nothing was evaluated: no policy is active."}</p>
            )}
            <div className="divide-y">
              {main.map((f) => (
                <FindingRow key={f.id} finding={f} selected={f.id === selectedId} onSelect={() => onSelect({ kind: "finding", id: f.id })} />
              ))}
            </div>
            {ai.length > 0 && (
              <div className="border-t">
                <div className="flex items-center gap-1.5 bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground" data-testid="ai-suggested-header">
                  <Sparkles className="size-3.5" />
                  AI-suggested ({ai.length})
                  <span className="font-normal">outside the compiled policy; a reviewer decides</span>
                </div>
                <div className="divide-y">
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
    <div className="divide-y">
      {claims
        .filter((c) => c.status !== "rejected")
        .map((c) => {
          const mine = findings.filter((f) => f.claimLogicalKey === c.logicalKey);
          return (
            <button key={c.id} type="button" onClick={() => onSelect(c.logicalKey)} data-testid={`claim-${c.logicalKey}`} className={cn("block w-full border-l-2 border-transparent px-3 py-2 text-left hover:bg-muted", selectedKey === c.logicalKey && "border-foreground bg-muted")}>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-mono font-medium text-foreground">{c.logicalKey}</span>
                <span className="font-mono text-muted-foreground">{c.turnLabels.join("+")}</span>
                {c.comparison && <span className="text-muted-foreground">public: {c.comparison.outcome.replaceAll("_", " ")}</span>}
                {mine.map((f) => (
                  <StateChip key={f.id} state={f.state} title={f.label} className="text-muted-foreground" />
                ))}
                {c.status === "reviewer_corrected" && <span className="text-muted-foreground">corrected</span>}
              </div>
              <div className="mt-1 line-clamp-2 text-sm text-foreground">{c.fields.summary}</div>
            </button>
          );
        })}
      <p className="px-3 py-2 text-xs text-muted-foreground">{plural(claims.filter((c) => c.status !== "rejected").length, "claim")} extracted. Every quote was checked character for character against the transcript.</p>
    </div>
  );
}
