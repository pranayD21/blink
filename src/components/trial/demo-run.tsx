"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { snapshot, startTrial, subscribe } from "@/components/app/trial-coach";
import { Button } from "@/components/ui/button";
import {
  CALL_DURATION,
  type MonitorId,
  SNAPSHOTS,
  activeTurnAt,
  formatClock,
  snapshotAt,
} from "./call-data";
import { FsmDiagram } from "./fsm-diagram";
import { SlidingTabs } from "./sliding-tabs";

type WorkflowStage = "workflow" | "call" | "review" | "brief";
type EngineTab = "simple" | "fsm";

const WORKFLOW_TABS = [
  { value: "workflow", label: "1. Setup", testId: "stage-tab-workflow" },
  { value: "call", label: "2. Live call", testId: "stage-tab-call" },
  { value: "review", label: "3. Review", testId: "stage-tab-review" },
  { value: "brief", label: "4. Brief", testId: "stage-tab-brief" },
] as const;

const ENGINE_TABS = [
  { value: "simple", label: "Summary", testId: "engine-tab-simple" },
  { value: "fsm", label: "State machine", testId: "toggle-fsm" },
] as const;

const MONITOR_TABS: readonly { value: MonitorId; label: string; testId: string }[] = [
  { value: "M1", label: "Internal data", testId: "monitor-tab-M1" },
  { value: "M2", label: "Former login", testId: "monitor-tab-M2" },
  { value: "M4", label: "Recent exit", testId: "monitor-tab-M4" },
];

const WORKFLOW_STEPS = [
  { num: "1", title: "Load rules & filings", body: "Firm policy becomes state machines and Halvorsen's Q2 filing (-8% orders) is loaded." },
  { num: "2", title: "Warn live on one pill", body: "Priya sees Amber or Red in real time, without seeing the transcript." },
  { num: "3", title: "Hold flagged quotes", body: "Compliance checks any flagged quote alongside the public filing." },
  { num: "4", title: "Send a clean brief", body: "Priya receives cleared notes, with restricted lines removed." },
] as const;

function guidedStageFor(step: number | null): WorkflowStage | null {
  if (step === null) return null;
  if (step === 0) return "workflow";
  if (step >= 1 && step <= 3) return "call";
  if (step === 4) return "review";
  return "brief";
}

function guidedCueTime(step: number | null): number | null {
  if (step === 1) return 0;
  if (step === 2) return 32.48;
  if (step === 3) return 46.5;
  return null;
}

/** Calm, single-surface Halvorsen Pumps live call demo and state-machine inspector. */
export function DemoRun() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const step = raw === null || raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [manualStage, setManualStage] = useState<WorkflowStage>("call");
  const [manualEngineTab, setManualEngineTab] = useState<EngineTab>("simple");
  const [manualMonitor, setManualMonitor] = useState<MonitorId | null>(null);
  const [audioTime, setAudioTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sealed, setSealed] = useState(false);

  const stage: WorkflowStage = guidedStageFor(step) ?? manualStage;
  const engineTab: EngineTab = step === 3 ? "fsm" : manualEngineTab;

  const cueTime = guidedCueTime(step);
  const effectiveTime = playing ? audioTime : cueTime !== null && audioTime < cueTime ? cueTime : audioTime;

  const snap = snapshotAt(effectiveTime);
  const activeTurn = activeTurnAt(effectiveTime);
  const activeMonitorId: MonitorId = manualMonitor ?? snap.focusMonitor;
  const activeMonitor = snap.monitors[activeMonitorId];

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || step === null) return;
    if (step === 1) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    } else if (step === 2) {
      audio.currentTime = 32.48;
      audio.play().catch(() => {});
    } else if (step === 3) {
      audio.currentTime = 45.2;
      audio.play().catch(() => {});
    } else if (step >= 4) {
      audio.pause();
    }
  }, [step]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio && !audio.paused) {
        setAudioTime(audio.currentTime);
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function seekAndPlay(targetSeconds: number, shouldPlay = true) {
    const clamped = Math.max(0, Math.min(CALL_DURATION, targetSeconds));
    setAudioTime(clamped);
    setManualMonitor(null);
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clamped;
    if (shouldPlay) {
      audio.play().catch(() => {
        setPlaying(false);
      });
    }
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }
    if (audio.currentTime >= CALL_DURATION - 0.3) {
      audio.currentTime = 0;
      setAudioTime(0);
    }
    audio.play().catch(() => {
      setPlaying(false);
    });
  }

  function enterLiveCall() {
    setManualStage("call");
    requestAnimationFrame(() => seekAndPlay(0, true));
  }

  const escalatedMonitor = SNAPSHOTS[6].monitors.M2;
  const mismatchFiling = SNAPSHOTS[6].filing!;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-6 pt-8 pb-28" data-testid="demo-run">
      <audio
        ref={audioRef}
        src="/demo-call.mp3"
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setAudioTime(e.currentTarget.currentTime)}
        onEnded={() => {
          setPlaying(false);
          setAudioTime(CALL_DURATION);
        }}
      />

      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl text-foreground">Halvorsen Pumps</h1>

        <div className="flex flex-wrap items-center gap-3" data-demo="workflow">
          <SlidingTabs
            options={WORKFLOW_TABS}
            value={stage}
            onChange={(next) => {
              if (next !== "call" && audioRef.current) audioRef.current.pause();
              setManualStage(next);
            }}
            ariaLabel="Blink workflow stages"
            testId="workflow-tabs"
          />
          {step === null && (
            <Button type="button" variant="outline" onClick={startTrial} data-testid="demo-start">
              Guided tour
            </Button>
          )}
        </div>
      </header>

      {stage === "workflow" && (
        <section className="glass-surface px-8 py-8">
          <div className="grid gap-8 sm:grid-cols-2">
            {WORKFLOW_STEPS.map((item) => (
              <div key={item.num} className="space-y-1.5">
                <span className="text-sm font-medium text-muted-foreground">0{item.num}</span>
                <h2 className="text-xl font-medium text-foreground">{item.title}</h2>
                <p className="text-base leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6">
            <p className="text-base text-muted-foreground">
              Priya Raman (Banker) &amp; Ray Castellano (Former Sales VP, left 3 months ago)
            </p>
            <Button type="button" className="h-12 px-8 text-base" onClick={enterLiveCall} data-testid="sit-in-call">
              Play live call
            </Button>
          </div>
        </section>
      )}

      {stage === "call" && (
        <section className="glass-surface overflow-hidden" data-demo="live-room">
          <div className="border-b px-8 py-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="live-pill" data-level={snap.pill.level} data-demo="pill" data-testid="demo-live-pill">
                <span className="live-pill-dot" aria-hidden />
                <span className="text-lg font-medium text-foreground">{snap.pill.text}</span>
              </div>

              <div className="flex items-center gap-4">
                <span className="tabular-nums text-base text-muted-foreground">
                  {formatClock(effectiveTime)} / {formatClock(CALL_DURATION)}
                </span>
                <Button type="button" onClick={togglePlay} data-testid="play-call">
                  {playing ? "Pause" : effectiveTime > 0.5 && effectiveTime < CALL_DURATION - 0.5 ? "Resume" : "Play call"}
                </Button>
              </div>
            </div>

            <div className="mt-5">
              <div
                className="call-track"
                role="slider"
                tabIndex={0}
                aria-label="Call timeline"
                aria-valuemin={0}
                aria-valuemax={CALL_DURATION}
                aria-valuenow={Math.round(effectiveTime)}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  seekAndPlay(ratio * CALL_DURATION, playing);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") seekAndPlay(effectiveTime + 5, playing);
                  if (e.key === "ArrowLeft") seekAndPlay(effectiveTime - 5, playing);
                }}
              >
                <div className="call-track-fill" style={{ width: `${Math.min(100, (effectiveTime / CALL_DURATION) * 100)}%` }} />
              </div>
            </div>
          </div>

          <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="flex flex-col px-8 py-8" data-demo="call">
              <div>
                <p className="text-base text-muted-foreground">
                  {activeTurn.speaker === "analyst" ? "Priya Raman · Banker" : "Ray Castellano · Expert"}
                </p>

                <p className="mt-4 text-2xl leading-relaxed">
                  {activeTurn.words.map(([word, ws, we], idx) => {
                    const spoken = effectiveTime >= ws;
                    const now = playing && effectiveTime >= ws && effectiveTime <= we + 0.08;
                    return (
                      <span
                        key={idx}
                        className={
                          now
                            ? "word-now"
                            : spoken || (!playing && effectiveTime >= activeTurn.start)
                              ? "word-spoken"
                              : "word-upcoming"
                        }
                      >
                        {word}{" "}
                      </span>
                    );
                  })}
                </p>
              </div>
            </div>

            <div className="flex flex-col px-8 py-8" data-demo="engine">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SlidingTabs
                    options={ENGINE_TABS}
                    value={engineTab}
                    onChange={(next) => setManualEngineTab(next)}
                    ariaLabel="Engine view mode"
                  />
                </div>

                {engineTab === "simple" ? (
                  <div className="mt-6 space-y-5">
                    <div>
                      <h2 className="text-2xl font-medium leading-snug text-foreground">{snap.headline}</h2>
                      <p className="mt-2 text-lg leading-relaxed text-muted-foreground">{snap.summary}</p>
                    </div>

                    {snap.filing && (
                      <div className="grid grid-cols-2 gap-4 border-t pt-5">
                        <div>
                          <p className="text-sm text-muted-foreground">Spoken on call</p>
                          <p className="mt-1 text-lg font-medium text-foreground">{snap.filing.expertSummary}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Public record</p>
                          <p className="mt-1 text-lg font-medium text-foreground">{snap.filing.filedSummary}</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-xl font-medium text-foreground">{activeMonitor.title}</h2>
                      {MONITOR_TABS.length > 1 && (
                        <div className="flex items-center gap-1.5 text-sm">
                          {MONITOR_TABS.map((m) => (
                            <button
                              key={m.value}
                              type="button"
                              data-testid={m.testId}
                              onClick={() => setManualMonitor(m.value)}
                              className={
                                m.value === activeMonitorId
                                  ? "rounded-full bg-secondary px-3 py-1 font-medium text-foreground"
                                  : "rounded-full px-3 py-1 text-muted-foreground hover:text-foreground"
                              }
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <FsmDiagram monitor={activeMonitor} />
                  </div>
                )}
              </div>

              {effectiveTime >= 42 && step === null && (
                <div className="mt-6 pt-2">
                  <Button
                    type="button"
                    onClick={() => {
                      audioRef.current?.pause();
                      setManualStage("review");
                    }}
                  >
                    Review flagged quote
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {stage === "review" && (
        <section className="glass-surface space-y-6 px-8 py-8" data-demo="finding">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-2xl text-foreground">Flagged quote held for compliance</h2>
            <span className="text-base font-medium text-destructive">{sealed ? "Hidden from banker" : "Escalated"}</span>
          </div>

          <blockquote className="border-l-2 pl-5 text-xl leading-relaxed text-foreground">
            “Yeah, that twenty percent is Halvorsen&apos;s West region for Q3. IT never shut off my old Salesforce pipeline login when I left, and when I checked last week, Q3 bookings were down nineteen point eight percent year over year.”
          </blockquote>

          <div className="grid gap-6 border-t pt-5 sm:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">Spoken on call</p>
              <p className="mt-1 text-lg font-medium text-foreground">{mismatchFiling.expertSummary} (via Salesforce login)</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{mismatchFiling.docTitle}</p>
              <p className="mt-1 text-lg font-medium text-foreground">{mismatchFiling.filedSummary}</p>
            </div>
          </div>

          <details className="border-t pt-4">
            <summary className="cursor-pointer text-base text-muted-foreground hover:text-foreground">
              View state machine
            </summary>
            <div className="mt-4 max-w-xl">
              <FsmDiagram monitor={escalatedMonitor} />
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-4 border-t pt-6">
            {!sealed ? (
              <Button
                type="button"
                className="h-12 px-8 text-base"
                data-demo="decide"
                data-testid="demo-keep-hidden"
                onClick={() => {
                  setSealed(true);
                  if (step === null) setManualStage("brief");
                }}
              >
                Keep hidden from banker
              </Button>
            ) : (
              <>
                <span className="sealed-bar text-base">Hidden from banker</span>
                <Button type="button" onClick={() => setManualStage("brief")}>
                  Open safe brief
                </Button>
              </>
            )}
          </div>
        </section>
      )}

      {stage === "brief" && (
        <section className="glass-surface grid divide-y overflow-hidden lg:grid-cols-2 lg:divide-x lg:divide-y-0" data-demo="note">
          <div className="space-y-4 px-8 py-8">
            <span className="text-sm font-medium text-success">Sent to Priya Raman</span>
            <h2 className="text-2xl text-foreground">Safe research brief</h2>
            <p className="text-lg leading-relaxed text-foreground">
              Industrial pump distributors are working through prior-year inventory overhang, softening near-term restocking across the channel.
            </p>
            <p className="text-lg leading-relaxed text-foreground">
              Published trade reports show hot-rolled steel up roughly 12% over the past six months, while manufacturers pushed through two catalog price increases this year.
            </p>
          </div>

          <div className="space-y-4 px-8 py-8">
            <span className="text-sm font-medium text-muted-foreground">Withheld by compliance</span>
            <h2 className="text-2xl text-foreground">Redacted in transcript</h2>
            <p className="text-base text-muted-foreground">
              Ray&apos;s Q3 Halvorsen figure (-19.8%) and his active Salesforce login never reach Priya:
            </p>
            <div className="pt-1">
              <span className="sealed-bar" aria-label="Hidden by compliance">
                Hidden by compliance
              </span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
