"use client";

import { Link2 } from "lucide-react";
import { HIGHLIGHT, toneOf } from "@/components/app/status-chip";
import { cn } from "@/lib/utils";
import type { WorkspacePayload } from "@/server/services/workspace";
import { type Selection, leadFinding, spansForTurn } from "./model";

const SPEAKER_LABEL: Record<string, string> = { analyst: "Analyst", expert: "Expert", moderator: "Moderator" };

export function TranscriptPane({ payload, selectedClaimKey, onSelect }: { payload: WorkspacePayload; selectedClaimKey: string | null; onSelect: (s: Selection) => void }) {
  const transcript = payload.transcript;
  if (!transcript) return <div className="p-6 text-sm text-muted-foreground">No transcript has been uploaded yet.</div>;

  const selectedClaim = selectedClaimKey ? payload.claims.find((c) => c.logicalKey === selectedClaimKey) : null;
  const linkedTurns = new Set(selectedClaim?.turnLabels ?? []);
  const primaryTurn = selectedClaim?.quotes.find((q) => q.role === "primary")?.turnLabel ?? null;

  return (
    <div className="divide-y" data-testid="transcript-pane">
      {transcript.turns.map((turn) => {
        const spans = spansForTurn(payload.claims, turn.label);
        const linked = linkedTurns.has(turn.label);
        const others = [...linkedTurns].filter((t) => t !== turn.label);
        const pieces: React.ReactNode[] = [];
        let cursor = 0;
        for (const span of spans) {
          if (span.start > cursor) pieces.push(turn.text.slice(cursor, span.start));
          const finding = leadFinding(payload.findings, span.claimKey);
          const tone = finding ? toneOf(finding.state) : "none";
          const isSelected = span.claimKey === selectedClaimKey;
          pieces.push(
            <button
              key={`${span.claimKey}-${span.start}`}
              type="button"
              data-testid={`highlight-${turn.label}-${span.claimKey}`}
              title={finding ? `${finding.label} · ${finding.state}` : `${span.claimKey} · no finding`}
              onClick={() => onSelect(finding ? { kind: "finding", id: finding.id } : { kind: "claim", key: span.claimKey })}
              className={cn("cursor-pointer rounded-sm px-0.5 text-left underline decoration-2 underline-offset-[3px] transition-colors", HIGHLIGHT[tone], !finding && "bg-transparent decoration-dotted", isSelected && "ring-2 ring-foreground ring-offset-1 ring-offset-background")}
            >
              {turn.text.slice(span.start, span.end)}
            </button>,
          );
          cursor = span.end;
        }
        if (cursor < turn.text.length) pieces.push(turn.text.slice(cursor));

        return (
          <div key={turn.id} id={`turn-${turn.label}`} data-testid={`turn-${turn.label}`} className={cn("flex gap-3 px-4 py-2.5 text-sm leading-relaxed", linked && "bg-muted", turn.speaker !== "expert" && "text-muted-foreground")}>
            <div className="w-9 shrink-0 pt-0.5 font-mono text-xs text-muted-foreground">{turn.label}</div>
            <div className="min-w-0 flex-1">
              <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs">
                <span className={cn("font-semibold", turn.speaker === "expert" ? "text-foreground" : "text-muted-foreground")}>{SPEAKER_LABEL[turn.speaker] ?? turn.speaker}</span>
                <span className="text-muted-foreground">{turn.speakerName}</span>
                {turn.timestamp && <span className="font-mono text-muted-foreground">{turn.timestamp}</span>}
                {turn.change === "edited" && (
                  <span className="text-muted-foreground" title="This turn's text differs from the previous transcript version">
                    edited in v{transcript.versionNo}
                  </span>
                )}
                {turn.change === "added" && <span className="text-muted-foreground">added in v{transcript.versionNo}</span>}
                {linked && others.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-muted-foreground" data-testid={`linked-badge-${turn.label}`}>
                    <Link2 className="size-3" />
                    {turn.label === primaryTurn ? "statement" : "adds context"} · linked to {others.join(", ")}
                  </span>
                )}
              </div>
              <p className="text-foreground">{pieces}</p>
            </div>
          </div>
        );
      })}
      {transcript.removedTurns.length > 0 && (
        <div className="bg-muted px-4 py-3 text-xs text-muted-foreground">
          Removed in v{transcript.versionNo}: {transcript.removedTurns.map((t) => `${t.label} “${t.text.slice(0, 80)}${t.text.length > 80 ? "…" : ""}”`).join("; ")}
        </div>
      )}
    </div>
  );
}
