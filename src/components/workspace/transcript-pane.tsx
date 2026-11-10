"use client";

import { Link2 } from "lucide-react";
import { Chip, HIGHLIGHT, toneOf } from "@/components/app/status-chip";
import { cn } from "@/lib/utils";
import type { WorkspacePayload } from "@/server/services/workspace";
import { type Selection, leadFinding, spansForTurn } from "./model";

const SPEAKER_LABEL: Record<string, string> = { analyst: "Analyst", expert: "Expert", moderator: "Moderator" };

export function TranscriptPane({ payload, selectedClaimKey, onSelect }: { payload: WorkspacePayload; selectedClaimKey: string | null; onSelect: (s: Selection) => void }) {
  const transcript = payload.transcript;
  if (!transcript) return <div className="p-6 text-sm text-slate-500">No transcript has been uploaded yet.</div>;

  const selectedClaim = selectedClaimKey ? payload.claims.find((c) => c.logicalKey === selectedClaimKey) : null;
  const linkedTurns = new Set(selectedClaim?.turnLabels ?? []);
  const primaryTurn = selectedClaim?.quotes.find((q) => q.role === "primary")?.turnLabel ?? null;

  return (
    <div className="divide-y divide-slate-100" data-testid="transcript-pane">
      {transcript.turns.map((turn) => {
        const spans = spansForTurn(payload.claims, turn.label);
        const linked = linkedTurns.has(turn.label);
        const others = [...linkedTurns].filter((t) => t !== turn.label);
        const pieces: React.ReactNode[] = [];
        let cursor = 0;
        for (const span of spans) {
          if (span.start > cursor) pieces.push(turn.text.slice(cursor, span.start));
          const finding = leadFinding(payload.findings, span.claimKey);
          const tone = finding ? toneOf(finding.state) : "slate";
          const isSelected = span.claimKey === selectedClaimKey;
          pieces.push(
            <button
              key={`${span.claimKey}-${span.start}`}
              type="button"
              data-testid={`highlight-${turn.label}-${span.claimKey}`}
              title={finding ? `${finding.label} · ${finding.state}` : `${span.claimKey} · no finding`}
              onClick={() => onSelect(finding ? { kind: "finding", id: finding.id } : { kind: "claim", key: span.claimKey })}
              className={cn("cursor-pointer rounded-sm px-0.5 text-left underline decoration-2 underline-offset-[3px] transition-colors", HIGHLIGHT[tone], !finding && "bg-transparent decoration-dotted", isSelected && "ring-2 ring-indigo-500 ring-offset-1")}
            >
              {turn.text.slice(span.start, span.end)}
            </button>,
          );
          cursor = span.end;
        }
        if (cursor < turn.text.length) pieces.push(turn.text.slice(cursor));

        return (
          <div key={turn.id} id={`turn-${turn.label}`} data-testid={`turn-${turn.label}`} className={cn("flex gap-3 px-4 py-2.5 text-sm leading-relaxed", linked && "bg-indigo-50/50", turn.speaker !== "expert" && "text-slate-600")}>
            <div className="w-9 shrink-0 pt-0.5 font-mono text-xs text-slate-400">{turn.label}</div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("font-semibold", turn.speaker === "expert" ? "text-slate-900" : "text-slate-500")}>{SPEAKER_LABEL[turn.speaker] ?? turn.speaker}</span>
                <span className="text-slate-400">{turn.speakerName}</span>
                {turn.timestamp && <span className="font-mono text-slate-300">{turn.timestamp}</span>}
                {turn.change === "edited" && (
                  <Chip tone="sky" title="This turn's text differs from the previous transcript version">
                    edited in v{transcript.versionNo}
                  </Chip>
                )}
                {turn.change === "added" && <Chip tone="sky">added in v{transcript.versionNo}</Chip>}
                {linked && others.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-px text-[11px] font-medium text-indigo-700" data-testid={`linked-badge-${turn.label}`}>
                    <Link2 className="size-3" />
                    {turn.label === primaryTurn ? "statement" : "adds context"} · linked to {others.join(", ")}
                  </span>
                )}
              </div>
              <p className="text-slate-800">{pieces}</p>
            </div>
          </div>
        );
      })}
      {transcript.removedTurns.length > 0 && (
        <div className="bg-slate-50 px-4 py-3 text-xs text-slate-500">
          Removed in v{transcript.versionNo}: {transcript.removedTurns.map((t) => `${t.label} “${t.text.slice(0, 80)}${t.text.length > 80 ? "…" : ""}”`).join("; ")}
        </div>
      )}
    </div>
  );
}
