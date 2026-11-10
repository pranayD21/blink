"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusDot, type DotTone } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import type { PillView } from "@/core/live/client";
import { STAGES, type Stage } from "@/core/live/health";
import { api, errorMessage } from "@/lib/api";
import { type ScriptTurn, scriptTurnSource } from "@/lib/live/script-source";
import { type TurnSource, liveTurnSource, runCall } from "@/lib/live/session";

declare global {
  interface Window {
    /** Set by the banker's Mac app; absent in a browser. */
    blinkDesktop?: { isDesktop: boolean; setPillVisible(visible: boolean): void };
  }
}

export interface ControlCase {
  id: string;
  title: string;
  issuer: string;
  ticker: string;
}

export type ControlSource = { kind: "live" } | { kind: "script"; paceMs: number };

type Phase = "idle" | "starting" | "live" | "stopping" | "ended";

const STAGE_LABEL: Record<Stage, string> = { hearing: "Hearing", transcribing: "Transcribing", reading: "Reading", rules: "Rules", screen: "Screen" };

const PHASE_LINE: Record<Exclude<Phase, "ended">, string> = {
  idle: "Pick the case and press Start when the call begins.",
  starting: "Starting the call…",
  live: "Blink is listening. Press Stop when the call is over.",
  stopping: "Ending the call…",
};

/**
 * Starts and stops the banker's call. Every view of the pill goes to the pill window on the
 * `blink-pill` channel; this window shows only the cases, the buttons, and whether each stage
 * of the live path is working. Nothing anyone said is ever shown here.
 */
export function CallControl({ banker, cases, source }: { banker: string; cases: ControlCase[]; source: ControlSource }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const [down, setDown] = useState<ReadonlySet<Stage>>(new Set());
  const [endedText, setEndedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const call = useRef<{ end(): Promise<void> } | null>(null);
  const stopping = useRef(false);

  useEffect(() => {
    channel.current = new BroadcastChannel("blink-pill");
    return () => {
      channel.current?.close();
      channel.current = null;
      // Leaving the window ends the call rather than leaving it live with nobody listening.
      void call.current?.end().catch(() => undefined);
    };
  }, []);

  const show = (view: PillView) => {
    channel.current?.postMessage(view);
    window.blinkDesktop?.setPillVisible(view.level !== "idle");
    if (view.level === "ended") setEndedText(view.text);
  };

  const onStage = (stage: Stage, up: boolean) =>
    setDown((prev) => {
      const next = new Set(prev);
      if (up) next.delete(stage);
      else next.add(stage);
      return next;
    });

  const stop = async () => {
    const current = call.current;
    if (!current || stopping.current) return;
    stopping.current = true;
    setPhase("stopping");
    try {
      await current.end();
      call.current = null;
      setDown(new Set());
      setActiveCase(null);
      setPhase("ended");
      router.refresh(); // the case is no longer at intake
    } catch (err) {
      setError(`The call could not be ended: ${errorMessage(err)} Press Stop to try again.`);
      setPhase("live");
    } finally {
      stopping.current = false;
    }
  };

  const start = async (caseId: string) => {
    setError(null);
    setEndedText(null);
    setDown(new Set());
    setActiveCase(caseId);
    setPhase("starting");
    try {
      let turns: TurnSource | ((callId: string) => TurnSource);
      let scriptDone: Promise<void> | null = null;
      if (source.kind === "script") {
        const script = scriptTurnSource((await api<{ turns: ScriptTurn[] }>("/api/dev/script-turns")).turns, source.paceMs);
        scriptDone = script.done;
        turns = script;
      } else {
        turns = (callId) => liveTurnSource(callId);
      }
      window.blinkDesktop?.setPillVisible(true);
      call.current = await runCall({ caseId, source: turns, onView: show, onStage });
      setPhase("live");
      // A scripted call is over when its last turn is out.
      if (scriptDone) void scriptDone.then(stop);
    } catch (err) {
      call.current = null;
      window.blinkDesktop?.setPillVisible(false);
      setActiveCase(null);
      setPhase("idle");
      setError(`The call could not start: ${errorMessage(err)}`);
    }
  };

  const busy = phase === "starting" || phase === "live" || phase === "stopping";
  const tone = (stage: Stage): DotTone => (!busy ? "none" : down.has(stage) ? "warn" : "good");

  return (
    <main className="flex flex-1 flex-col gap-4 p-5 text-sm">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="font-semibold text-foreground">Blink</h1>
        <span className="text-xs text-muted-foreground" data-testid="banker">
          Banker: {banker}
        </span>
      </header>

      {source.kind === "script" && <p className="text-xs text-muted-foreground">Scripted call: the turns come from a script, not the microphone.</p>}

      <section className="flex flex-col divide-y rounded-xl border bg-card">
        {cases.length === 0 && activeCase === null ? (
          <p className="p-3 text-muted-foreground" data-testid="no-callable-cases">
            No case is waiting for a call. A call can start on a case of yours that has no transcript yet.
          </p>
        ) : (
          cases.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 p-3" data-testid={`call-case-${c.id}`}>
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{c.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.issuer} · {c.ticker}
                </div>
              </div>
              {busy && activeCase === c.id ? (
                <Button size="sm" variant="outline" data-testid="stop-call" disabled={phase !== "live"} onClick={() => void stop()}>
                  Stop
                </Button>
              ) : (
                <Button size="sm" data-testid={`start-call-${c.id}`} disabled={busy} onClick={() => void start(c.id)}>
                  Start
                </Button>
              )}
            </div>
          ))
        )}
      </section>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" data-testid="stages">
        {STAGES.map((stage) => (
          <StatusDot key={stage} tone={tone(stage)} data-testid={`stage-${stage}`} data-up={busy ? String(!down.has(stage)) : undefined}>
            {STAGE_LABEL[stage]}
            {busy && down.has(stage) && <em className="text-muted-foreground not-italic">down</em>}
          </StatusDot>
        ))}
      </div>

      {phase === "ended" ? (
        <p className="text-foreground" data-testid="call-ended">
          {endedText ?? "Call ended."}
        </p>
      ) : (
        <p className="text-muted-foreground" data-testid="call-phase" data-phase={phase}>
          {PHASE_LINE[phase]}
        </p>
      )}
      {error && (
        <p className="text-destructive" role="alert" data-testid="call-error">
          {error}
        </p>
      )}
    </main>
  );
}
