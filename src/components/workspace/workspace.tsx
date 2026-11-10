"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkspacePayload } from "@/server/services/workspace";
import { CaseHeader } from "./case-header";
import { EvidencePane } from "./evidence-pane";
import { FindingsPane } from "./findings-pane";
import { type Selection, isOpen, scrollToTurn } from "./model";
import { TranscriptPane } from "./transcript-pane";
import type { TranscriptSample } from "./upload-transcript";
import { useReviewTimer } from "./use-review-timer";

/** The review workspace (§15.2): transcript · findings · evidence. */
export function Workspace({ payload, samples, allowGold }: { payload: WorkspacePayload; samples: TranscriptSample[]; allowGold: boolean }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<"findings" | "claims">("findings");
  const [focus, setFocus] = useState<"escalate" | "dispose" | null>(null);
  useReviewTimer(payload.case.id, "blink", Boolean(payload.transcript));

  // Policy and reviewer findings first, then AI suggestions: the order they are listed in.
  const ordered = useMemo(() => [...payload.findings.filter((f) => f.origin !== "ai_suggested"), ...payload.findings.filter((f) => f.origin === "ai_suggested")], [payload.findings]);

  // Keep the selection valid as the payload changes; start on the first open finding.
  const effective: Selection = useMemo(() => {
    if (selection?.kind === "finding" && payload.findings.some((f) => f.id === selection.id)) return selection;
    if (selection?.kind === "claim" && payload.claims.some((c) => c.logicalKey === selection.key)) return selection;
    const first = ordered.find(isOpen) ?? ordered[0];
    return first ? { kind: "finding", id: first.id } : null;
  }, [selection, payload.findings, payload.claims, ordered]);

  const selectedFinding = effective?.kind === "finding" ? payload.findings.find((f) => f.id === effective.id) : undefined;
  const selectedClaimKey = selectedFinding ? selectedFinding.claimLogicalKey : effective?.kind === "claim" ? effective.key : null;

  const select = useCallback(
    (next: Selection, options: { scroll?: boolean } = {}) => {
      setSelection(next);
      setFocus(null);
      if (next?.kind === "claim") setView("claims");
      if (next?.kind === "finding") setView("findings");
      if (options.scroll === false) return;
      const turn = next?.kind === "finding" ? payload.findings.find((f) => f.id === next.id)?.primaryTurnLabel : next?.kind === "claim" ? payload.claims.find((c) => c.logicalKey === next.key)?.turnLabels[0] : null;
      if (turn) scrollToTurn(turn);
    },
    [payload.findings, payload.claims],
  );

  // j / k move between findings, e escalates, d disposes (§15.2).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "j" || e.key === "k") {
        if (ordered.length === 0) return;
        const at = ordered.findIndex((f) => f.id === selectedFinding?.id);
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, at + (e.key === "j" ? 1 : -1)))];
        if (next) select({ kind: "finding", id: next.id });
        e.preventDefault();
      }
      if ((e.key === "e" || e.key === "d") && selectedFinding) {
        setFocus(e.key === "e" ? "escalate" : "dispose");
        e.preventDefault();
        setTimeout(() => {
          document.querySelector<HTMLElement>('[data-testid="actions"]')?.scrollIntoView({ behavior: "smooth", block: "center" });
          document.getElementById("finding-rationale")?.focus();
        }, 50);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, selectedFinding, select]);

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col" data-testid="workspace">
      <CaseHeader payload={payload} samples={samples} allowGold={allowGold} refresh={refresh} />
      {payload.transcript ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,36fr)_minmax(0,30fr)_minmax(0,34fr)] divide-x bg-background">
          <div className="min-h-0 overflow-y-auto">
            <TranscriptPane payload={payload} selectedClaimKey={selectedClaimKey} onSelect={(s) => select(s, { scroll: false })} />
          </div>
          <div className="min-h-0">
            <FindingsPane payload={payload} selection={effective} onSelect={select} view={view} onViewChange={setView} />
          </div>
          <div className="min-h-0 overflow-y-auto">
            <EvidencePane payload={payload} selection={effective} onSelect={select} refresh={refresh} focus={focus} />
          </div>
        </div>
      ) : (
        <div className="grid flex-1 place-items-center bg-background p-8 text-center text-sm text-muted-foreground">
          <div className="max-w-md">
            <p className="font-medium text-foreground">No transcript yet.</p>
            <p className="mt-1">The analyst uploads the call transcript, or you can upload it with the button above. Analysis then runs in the background and its stages appear here.</p>
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-3 border-t bg-muted px-4 py-1 text-[11px] text-muted-foreground">
        <span>
          <kbd className="rounded border bg-background px-1 font-mono">j</kbd> <kbd className="rounded border bg-background px-1 font-mono">k</kbd> move between findings
        </span>
        <span>
          <kbd className="rounded border bg-background px-1 font-mono">e</kbd> escalate
        </span>
        <span>
          <kbd className="rounded border bg-background px-1 font-mono">d</kbd> dispose
        </span>
        <span className="ml-auto">Highlights are colored by finding state. Dotted underlines are statements with no finding.</span>
      </div>
    </div>
  );
}
