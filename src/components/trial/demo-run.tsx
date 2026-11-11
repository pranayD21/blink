"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { snapshot, startTrial, subscribe } from "@/components/app/trial-coach";
import { Button } from "@/components/ui/button";
import {
  CALL_DURATION,
  CALL_MOMENTS,
  type MonitorId,
  SNAPSHOTS,
  TURNS,
  activeTurnAt,
  formatClock,
  snapshotAt,
} from "./call-data";
import { FsmDiagram } from "./fsm-diagram";
import { SlidingTabs } from "./sliding-tabs";

type WorkflowStage = "workflow" | "call" | "review" | "brief";
type EngineTab = "simple" | "fsm";

const WORKFLOW_TABS = [
  { value: "workflow", label: "1. How Blink works", testId: "stage-tab-workflow" },
  { value: "call", label: "2. Sit in on the call", testId: "stage-tab-call" },
  { value: "review", label: "3. Compliance review", testId: "stage-tab-review" },
  { value: "brief", label: "4. Safe brief", testId: "stage-tab-brief" },
] as const;

const ENGINE_TABS = [
  { value: "simple", label: "Simple view", testId: "engine-tab-simple" },
  { value: "fsm", label: "FSM & math", testId: "toggle-fsm" },
] as const;

const MONITOR_TABS: readonly { value: MonitorId; label: string; testId: string }[] = [
  { value: "M1", label: "M1 · Internal (P2)", testId: "monitor-tab-M1" },
  { value: "M2", label: "M2 · Post-exit (P3)", testId: "monitor-tab-M2" },
  { value: "M4", label: "M4 · Recent exit (P5)", testId: "monitor-tab-M4" },
];

const WORKFLOW_STEPS = [
  {
    num: "1",
    title: "Compile policy into state machines",
    body: "Compliance writes rules in plain English. Blink compiles each rule into a deterministic finite-state machine, checks every evidence combination, and pins Halvorsen's public filings before the call starts.",
  },
  {
    num: "2",
    title: "Warn live without showing the transcript",
    body: "During the call, the banker sees only a small status pill. Blink transcribes both speakers, extracts claims, checks public filings, and flashes Amber or Red in under a second.",
  },
  {
    num: "3",
    title: "Hold flagged passages for a human",
    body: "Anything that triggers a rule is immediately sealed from the banker. A compliance officer reviews the exact quote, the 10-Q diff, and the state-machine trace, then records the decision.",
  },
  {
    num: "4",
    title: "Release a cited brief with zero leaks",
    body: "Blink drafts the research note from cleared statements only, verifies every citation, runs a deterministic leak check against sealed passages, and blanks restricted lines in the transcript.",
  },
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

/** Realistic Halvorsen Pumps workflow, live ElevenLabs call, real-time Kleene calculations, and FSM inspector. */
export function DemoRun() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const step = raw === null || raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [manualStage, setManualStage] = useState<WorkflowStage>("workflow");
  const [manualEngineTab, setManualEngineTab] = useState<EngineTab>("simple");
  const [manualMonitor, setManualMonitor] = useState<MonitorId | null>(null);
  const [showPolicyFsm, setShowPolicyFsm] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState<boolean>(false);

  const stage: WorkflowStage = guidedStageFor(step) ?? manualStage;
  const engineTab: EngineTab = step === 3 ? "fsm" : manualEngineTab;

  const cueTime = guidedCueTime(step);
  const effectiveTime = playing ? audioTime : cueTime !== null && audioTime < cueTime ? cueTime : audioTime;

  const snap = snapshotAt(effectiveTime);
  const activeTurn = activeTurnAt(effectiveTime);
  const activeMonitorId: MonitorId = manualMonitor ?? snap.focusMonitor;
  const activeMonitor = snap.monitors[activeMonitorId];

  // Sync the HTMLAudioElement when guided walkthrough steps change.
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
      audio.currentTime = 43.07;
      audio.play().catch(() => {});
    } else if (step >= 4) {
      audio.pause();
    }
  }, [step]);

  // Smooth 60fps word and scrubber updates while audio is playing.
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

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  }

  function enterLiveCall() {
    setManualStage("call");
    requestAnimationFrame(() => seekAndPlay(0, true));
  }

  const escalatedMonitor = SNAPSHOTS[6].monitors.M2;
  const mismatchFiling = SNAPSHOTS[6].filing!;

  return (
    <main className="mx-auto w-full max-w-[92rem] px-6 py-6" data-testid="demo-run">
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

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl text-foreground">Halvorsen Pumps · Live Compliance Run</h1>
          <p className="mt-2 max-w-3xl text-lg leading-snug text-muted-foreground">
            See the full Blink workflow, then sit in as banker Priya Raman interviews former Halvorsen sales VP Ray Castellano.
          </p>
        </div>
        {step === null && (
          <Button type="button" onClick={startTrial} data-testid="demo-start">
            Guided walkthrough
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-5 xl:flex-row xl:items-start">
        {step !== null && <div data-trial-dock className="h-[38rem] w-full shrink-0 xl:sticky xl:top-24 xl:order-last xl:w-96" />}

        <div className="min-w-0 flex-1 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3" data-demo="workflow">
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
          </div>

          {stage === "workflow" && (
            <div className="grid items-start gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <section className="glass-surface px-7 py-6">
                <h2 className="text-2xl text-foreground">Four steps from policy to a clean research brief</h2>
                <ol className="mt-5 space-y-4">
                  {WORKFLOW_STEPS.map((item) => (
                    <li key={item.num} className="rounded-2xl bg-muted/60 px-5 py-4">
                      <div className="flex items-baseline gap-3">
                        <span className="text-lg font-semibold tabular-nums text-foreground">{item.num}.</span>
                        <h3 className="text-xl font-medium text-foreground">{item.title}</h3>
                      </div>
                      <p className="mt-1.5 pl-6 text-base leading-relaxed text-muted-foreground">{item.body}</p>
                    </li>
                  ))}
                </ol>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button type="button" className="h-12 px-7 text-base" onClick={enterLiveCall} data-testid="sit-in-call">
                    Sit in on the live call
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowPolicyFsm((v) => !v)} data-testid="peek-policy-fsm">
                    {showPolicyFsm ? "Hide compiled FSM" : "Inspect compiled FSM"}
                  </Button>
                </div>
              </section>

              <section className="glass-surface px-7 py-6">
                <p className="text-base text-muted-foreground">Pinned before the call starts</p>
                <h2 className="mt-1 text-2xl text-foreground">Case packet & verified filings</h2>
                <dl className="mt-5 space-y-3.5 text-base">
                  <div className="rounded-2xl bg-muted/60 px-5 py-3.5">
                    <dt className="text-muted-foreground">Active policy bundle</dt>
                    <dd className="mt-0.5 font-medium text-foreground">Blink Capital v1 · Approved hash #a4f8c29e (4 monitors)</dd>
                  </div>
                  <div className="rounded-2xl bg-muted/60 px-5 py-3.5">
                    <dt className="text-muted-foreground">Covered issuer & calendar</dt>
                    <dd className="mt-0.5 font-medium text-foreground">Halvorsen Pumps (HLVP) · Q3 FY27 unreported until Dec 2</dd>
                  </div>
                  <div className="rounded-2xl bg-muted/60 px-5 py-3.5">
                    <dt className="text-muted-foreground">Verified SEC filing</dt>
                    <dd className="mt-0.5 font-medium text-foreground">Form 10-Q (Q2 FY27, Sep 8): total company orders -8.0% YoY</dd>
                  </div>
                  <div className="rounded-2xl bg-muted/60 px-5 py-3.5">
                    <dt className="text-muted-foreground">Expert profile</dt>
                    <dd className="mt-0.5 font-medium text-foreground">Ray Castellano · Former VP Sales West, left Jul 15 (3.6 mo ago)</dd>
                  </div>
                </dl>

                {showPolicyFsm && (
                  <div className="mt-5">
                    <FsmDiagram monitor={SNAPSHOTS[1].monitors.M4} />
                  </div>
                )}
              </section>
            </div>
          )}

          {stage === "call" && (
            <div className="space-y-5">
              <section className="glass-surface px-7 py-5" data-demo="live-room">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div data-demo="pill">
                    <p className="mb-1.5 text-base text-muted-foreground">What Priya sees on her screen (Banker pill)</p>
                    <div className="live-pill" data-level={snap.pill.level} data-testid="demo-live-pill">
                      <span className="live-pill-dot" aria-hidden />
                      <span className="text-lg font-medium text-foreground">{snap.pill.text}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="rounded-full bg-muted/60 px-4 py-2 text-base">
                      <span className={activeTurn.speaker === "analyst" && playing ? "font-semibold text-foreground" : "text-muted-foreground"}>
                        Priya · Banker
                      </span>
                      <span className="mx-2 text-muted-foreground">·</span>
                      <span className={activeTurn.speaker === "expert" && playing ? "font-semibold text-foreground" : "text-muted-foreground"}>
                        Ray · Expert
                      </span>
                    </div>
                    <Button type="button" onClick={togglePlay} data-testid="play-call">
                      {playing ? "Pause call" : effectiveTime > 0.5 && effectiveTime < CALL_DURATION - 0.5 ? "Resume call" : "Play live call"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => seekAndPlay(0, true)} data-testid="restart-call">
                      Replay
                    </Button>
                    <Button type="button" variant="outline" onClick={toggleMute} data-testid="mute-call">
                      {muted ? "Unmute" : "Mute"}
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

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-base">
                    <div className="flex flex-wrap items-center gap-2">
                      {CALL_MOMENTS.map((m) => (
                        <button
                          key={m.label}
                          type="button"
                          onClick={() => seekAndPlay(m.time, true)}
                          className="glass-press rounded-full bg-muted/60 px-3.5 py-1 text-base text-muted-foreground hover:text-foreground"
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {formatClock(effectiveTime)} / {formatClock(CALL_DURATION)}
                    </span>
                  </div>
                </div>
              </section>

              <div className="grid items-start gap-5 lg:grid-cols-[0.98fr_1.02fr]">
                <section className="glass-surface px-7 py-6" data-demo="call">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-xl text-foreground">Live conversation</h2>
                    <span className="text-base text-muted-foreground">Observer view · click any turn to jump</span>
                  </div>

                  <ol className="mt-4 space-y-2.5">
                    {TURNS.map((turn) => {
                      const isCurrent = activeTurn.id === turn.id;
                      const reached = effectiveTime >= turn.start;
                      const showFlag = turn.flag && effectiveTime >= turn.end - 0.6;
                      return (
                        <li key={turn.id}>
                          <button
                            type="button"
                            data-active={isCurrent}
                            data-flag={showFlag ? turn.flag : undefined}
                            onClick={() => seekAndPlay(turn.start, true)}
                            className="turn-card"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-base">
                              <span className="text-muted-foreground">
                                <span className="font-medium text-foreground">{turn.id}</span> · {turn.speakerName} ({turn.speaker === "analyst" ? "Banker" : "Expert"})
                              </span>
                              <span className="tabular-nums text-muted-foreground">
                                {showFlag && turn.flagNote ? (
                                  <span
                                    className={
                                      turn.flag === "red"
                                        ? "font-medium text-destructive"
                                        : turn.flag === "amber"
                                          ? "font-medium text-warning"
                                          : turn.flag === "cleared"
                                            ? "font-medium text-success"
                                            : "font-medium text-foreground"
                                    }
                                  >
                                    {turn.flagNote}
                                  </span>
                                ) : (
                                  formatClock(turn.start)
                                )}
                              </span>
                            </div>

                            <p className="mt-1.5 text-lg leading-snug">
                              {turn.words.map(([word, ws, we], idx) => {
                                const spoken = effectiveTime >= ws;
                                const now = playing && effectiveTime >= ws && effectiveTime <= we + 0.08;
                                return (
                                  <span key={idx} className={now ? "word-now" : spoken || (reached && !playing && effectiveTime >= turn.end - 0.4) ? "word-spoken" : "word-upcoming"}>
                                    {word}{" "}
                                  </span>
                                );
                              })}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </section>

                <section className="glass-surface px-7 py-6" data-demo="engine">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-base text-muted-foreground">{snap.stageLine}</p>
                      <h2 className="mt-0.5 text-xl text-foreground">Blink real-time engine</h2>
                    </div>
                    <SlidingTabs
                      options={ENGINE_TABS}
                      value={engineTab}
                      onChange={(next) => setManualEngineTab(next)}
                      ariaLabel="Engine view mode"
                    />
                  </div>

                  <div className="mt-4 rounded-2xl bg-muted/60 px-5 py-4">
                    <p className="text-xl font-medium leading-snug text-foreground">{snap.headline}</p>
                    <p className="mt-2 text-lg leading-relaxed text-muted-foreground">{snap.summary}</p>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-base tabular-nums text-muted-foreground">
                      <span>Flux STT {snap.timings.sttMs} ms</span>
                      <span>Claim reader {snap.timings.readerMs} ms</span>
                      <span>Pure reducer {snap.timings.reducerMs} ms</span>
                    </div>
                  </div>

                  {engineTab === "simple" ? (
                    <div className="mt-4 space-y-4">
                      {snap.filing && (
                        <div className="fsm-box">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-base font-medium text-foreground">Public document check ({snap.filing.claimKey})</span>
                            <span className={snap.filing.outcome === "mismatch" ? "font-semibold text-destructive" : "font-semibold text-success"}>
                              {snap.filing.outcome === "mismatch" ? "Mismatch vs filing" : "Exact public match"}
                            </span>
                          </div>
                          <p className="mt-1 text-base text-muted-foreground">{snap.filing.docTitle}</p>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl bg-muted/70 px-4 py-3">
                              <p className="text-base text-muted-foreground">Expert said</p>
                              <p className="mt-1 text-lg font-medium text-foreground">{snap.filing.expertSummary}</p>
                            </div>
                            <div className="rounded-xl bg-muted/70 px-4 py-3">
                              <p className="text-base text-muted-foreground">Public record says</p>
                              <p className="mt-1 text-lg font-medium text-foreground">{snap.filing.filedSummary}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="fsm-box">
                        <p className="text-base font-medium text-foreground">Live policy monitors</p>
                        <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
                          {(["M1", "M2", "M4"] as const).map((id) => {
                            const m = snap.monitors[id];
                            const tone =
                              m.state === "REVIEW_REQUIRED" || m.state === "ESCALATION_REQUESTED"
                                ? "text-destructive"
                                : m.state === "NEEDS_CONTEXT"
                                  ? "text-warning"
                                  : m.state === "NOT_TRIGGERED"
                                    ? "text-success"
                                    : "text-muted-foreground";
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => {
                                  setManualMonitor(id);
                                  setManualEngineTab("fsm");
                                }}
                                className="glass-press flex flex-col items-start rounded-xl bg-muted/60 px-4 py-3 text-left"
                              >
                                <span className="text-base font-medium text-foreground">
                                  {id} · {m.clause}
                                </span>
                                <span className={`mt-1 text-base font-medium ${tone}`}>
                                  {m.state === "ESCALATION_REQUESTED"
                                    ? "Escalated"
                                    : m.state === "REVIEW_REQUIRED"
                                      ? "Review required"
                                      : m.state === "NEEDS_CONTEXT"
                                        ? "Needs context"
                                        : m.state === "NOT_TRIGGERED"
                                          ? "Not triggered"
                                          : "Unassessed"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <Button type="button" variant="outline" onClick={() => setManualEngineTab("fsm")} data-testid="open-fsm-button">
                          Inspect FSM & Kleene math
                        </Button>
                        {effectiveTime >= 42 && (
                          <Button
                            type="button"
                            onClick={() => {
                              audioRef.current?.pause();
                              setManualStage("review");
                            }}
                          >
                            Review flagged passage
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <SlidingTabs
                          options={MONITOR_TABS}
                          value={activeMonitorId}
                          onChange={(next) => setManualMonitor(next)}
                          ariaLabel="Select policy monitor"
                        />
                      </div>

                      <FsmDiagram monitor={activeMonitor} />

                      {snap.filing && (
                        <div className="fsm-box">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-base font-medium text-foreground">Deterministic comparator ({snap.filing.claimKey})</span>
                            <span className={snap.filing.outcome === "mismatch" ? "font-semibold text-destructive" : "font-semibold text-success"}>
                              {snap.filing.outcome === "mismatch" ? "Mismatch" : "Exact match"}
                            </span>
                          </div>
                          <p className="mt-1 text-base text-muted-foreground">{snap.filing.docTitle}</p>
                          <div className="mt-3 space-y-2">
                            {snap.filing.rows.map((row) => (
                              <div key={row.dimension} className="grid grid-cols-[6rem_1fr_1fr] gap-3 rounded-xl bg-muted/60 px-4 py-2 text-base">
                                <span className="text-muted-foreground">{row.dimension}</span>
                                <span className="text-foreground">{row.expert}</span>
                                <span className={row.matches ? "text-success" : "text-destructive"}>{row.filed}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}

          {stage === "review" && (
            <div className="grid items-start gap-5 lg:grid-cols-2">
              <section className="glass-surface px-7 py-6" data-demo="finding">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base text-muted-foreground">Compliance review · Jordan Ellis</span>
                  <span className="font-medium text-destructive">{sealed ? "Dispositioned · Kept hidden" : "Escalation requested · R1, R2, R4"}</span>
                </div>
                <h2 className="mt-1 text-2xl text-foreground">Finding F1 · Linked turns T4 + T6</h2>
                <p className="mt-2 text-lg leading-snug text-muted-foreground">
                  Sealed from Priya the moment the call ended. A human officer decides whether these words ever enter research.
                </p>

                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl bg-muted/60 px-5 py-4">
                    <p className="text-base text-muted-foreground">T4 · Initial figure</p>
                    <p className="mt-1 text-lg text-foreground">
                      “Honestly, orders fell off a cliff in September... restocking is down roughly twenty percent.”
                    </p>
                  </div>
                  <div className="rounded-2xl bg-muted/60 px-5 py-4">
                    <p className="text-base text-muted-foreground">T6 · Internal Salesforce source & unreported Q3</p>
                    <p className="mt-1 text-lg text-foreground">
                      “Yeah, that twenty percent is Halvorsen&apos;s West region for Q3. IT never shut off my old Salesforce pipeline login when I left, and when I checked last week, Q3 bookings were down nineteen point eight percent year over year.”
                    </p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  {!sealed ? (
                    <Button
                      type="button"
                      className="h-12 px-7 text-base"
                      data-demo="decide"
                      data-testid="demo-keep-hidden"
                      onClick={() => {
                        setSealed(true);
                        if (step === null) setManualStage("brief");
                      }}
                    >
                      Keep hidden & seal
                    </Button>
                  ) : (
                    <>
                      <span className="sealed-bar text-base">Sealed on evidence hash #9c4e1b7a</span>
                      <Button type="button" onClick={() => setManualStage("brief")}>
                        View banker&apos;s safe brief
                      </Button>
                    </>
                  )}
                </div>
              </section>

              <section className="glass-surface px-7 py-6">
                <h2 className="text-xl text-foreground">Pinned evidence & FSM trace</h2>
                <p className="mt-1 text-base text-muted-foreground">
                  Code evaluated the state machine; the model only filled in the structured claim form.
                </p>
                <div className="mt-4">
                  <FsmDiagram monitor={escalatedMonitor} />
                </div>
                <div className="fsm-box mt-4">
                  <span className="text-base font-medium text-foreground">{mismatchFiling.docTitle}</span>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/60 px-4 py-2.5 text-base">
                      <span className="text-muted-foreground">Claimed: </span>
                      <span className="font-medium text-foreground">{mismatchFiling.expertSummary}</span>
                    </div>
                    <div className="rounded-xl bg-muted/60 px-4 py-2.5 text-base">
                      <span className="text-muted-foreground">Filed: </span>
                      <span className="font-medium text-foreground">{mismatchFiling.filedSummary}</span>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          )}

          {stage === "brief" && (
            <div className="grid items-start gap-5 lg:grid-cols-2" data-demo="note">
              <section className="glass-surface px-7 py-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base text-muted-foreground">Released to Priya Raman · Hash #7f2d08c4</span>
                  <span className="font-medium text-success">Leak check passed</span>
                </div>
                <h2 className="mt-1 text-2xl text-foreground">Research brief · Halvorsen Pumps</h2>
                <p className="mt-2 text-base text-muted-foreground">1 passage withheld by compliance. Every sentence cites an eligible claim.</p>

                <div className="mt-5 space-y-4 rounded-2xl bg-muted/60 px-6 py-5 text-lg leading-relaxed text-foreground">
                  <p>
                    Industrial pump distributors are working through prior-year inventory overhang, softening near-term restocking across the channel.
                  </p>
                  <p>
                    Published trade reports show hot-rolled steel up roughly 12% over the past six months, while manufacturers have pushed through two catalog price increases this year{" "}
                    <button
                      type="button"
                      onClick={() => setSelectedCitation((v) => !v)}
                      className="glass-press rounded-full bg-secondary px-3 py-0.5 text-base font-medium text-foreground"
                    >
                      [C2 · T8]
                    </button>
                    .
                  </p>
                </div>

                {selectedCitation && (
                  <div className="fsm-box mt-4 text-base">
                    <p className="font-medium text-foreground">Citation C2 · Verified against Steel & Castings Market Note</p>
                    <p className="mt-1 text-muted-foreground">
                      “From the public trade press, hot-rolled steel is up around twelve percent over six months, though most manufacturers pushed through two catalog price increases this year.”
                    </p>
                  </div>
                )}

                <div className="fsm-box mt-4 text-base">
                  <p className="font-medium text-foreground">Deterministic release gate</p>
                  <p className="mt-1 text-muted-foreground">
                    Checked brief sentences against sealed Finding F1 (T4, T6). Zero restricted figures (19.8%, Q3 West) or internal sources (Salesforce) appear.
                  </p>
                </div>
              </section>

              <section className="glass-surface px-7 py-6">
                <h2 className="text-xl text-foreground">Released transcript (Banker view)</h2>
                <p className="mt-1 text-base text-muted-foreground">Kept passages never leave the server; Priya sees sealed bars in their place.</p>

                <ol className="mt-4 space-y-3 text-base">
                  {TURNS.map((t) => {
                    const hidden = t.id === "T4" || t.id === "T5" || t.id === "T6";
                    return (
                      <li key={t.id} className="rounded-2xl bg-muted/60 px-4 py-3">
                        <div className="flex items-center justify-between text-muted-foreground">
                          <span>
                            {t.id} · {t.speakerName}
                          </span>
                          <span>{formatClock(t.start)}</span>
                        </div>
                        {hidden ? (
                          <div className="mt-2">
                            <span className="sealed-bar" aria-label="Hidden by compliance">
                              Hidden by compliance
                            </span>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-foreground">{t.text}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
