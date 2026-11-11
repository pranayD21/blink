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
  { value: "workflow", label: "1. How it works", testId: "stage-tab-workflow" },
  { value: "call", label: "2. Live call", testId: "stage-tab-call" },
  { value: "review", label: "3. Human review", testId: "stage-tab-review" },
  { value: "brief", label: "4. Safe brief", testId: "stage-tab-brief" },
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
  {
    num: "1",
    title: "Turn policy into live rules",
    body: "Firm rules become state machines, and Halvorsen's public filings are loaded before the call starts.",
  },
  {
    num: "2",
    title: "Warn the banker in real time",
    body: "Priya only sees a small status pill that turns Amber or Red if the call nears inside information.",
  },
  {
    num: "3",
    title: "Hold flagged quotes for compliance",
    body: "Anything that crosses a rule is hidden from Priya until a compliance officer checks the quote.",
  },
  {
    num: "4",
    title: "Send a safe research brief",
    body: "Priya gets a cited summary of cleared facts, with restricted lines blanked out of her transcript.",
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

/** Realistic Halvorsen Pumps workflow, live ElevenLabs call, and state-machine inspector. */
export function DemoRun() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const step = raw === null || raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [manualStage, setManualStage] = useState<WorkflowStage>("workflow");
  const [manualEngineTab, setManualEngineTab] = useState<EngineTab>("simple");
  const [manualMonitor, setManualMonitor] = useState<MonitorId | null>(null);
  const [audioTime, setAudioTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sealed, setSealed] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(false);

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
          <h1 className="text-3xl text-foreground">Halvorsen Pumps · Sample Call</h1>
          <p className="mt-2 max-w-3xl text-lg leading-snug text-muted-foreground">
            Banker Priya Raman interviews former Halvorsen sales VP Ray Castellano.
          </p>
        </div>
        {step === null && (
          <Button type="button" onClick={startTrial} data-testid="demo-start">
            Guided walkthrough
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-5 xl:flex-row xl:items-start">
        {step !== null && <div data-trial-dock className="min-h-[20rem] w-full shrink-0 xl:sticky xl:top-24 xl:order-last xl:w-96" />}

        <div className="min-w-0 flex-1 space-y-5">
          <div className="inline-flex max-w-full" data-demo="workflow">
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
                <h2 className="text-2xl text-foreground">How Blink protects a call</h2>
                <ol className="mt-5 space-y-3.5">
                  {WORKFLOW_STEPS.map((item) => (
                    <li key={item.num} className="rounded-2xl bg-muted/60 px-5 py-4">
                      <div className="flex items-baseline gap-3">
                        <span className="text-lg font-semibold tabular-nums text-foreground">{item.num}.</span>
                        <h3 className="text-xl font-medium text-foreground">{item.title}</h3>
                      </div>
                      <p className="mt-1.5 pl-6 text-lg leading-snug text-muted-foreground">{item.body}</p>
                    </li>
                  ))}
                </ol>
                <div className="mt-6">
                  <Button type="button" className="h-12 px-7 text-base" onClick={enterLiveCall} data-testid="sit-in-call">
                    Sit in on the live call
                  </Button>
                </div>
              </section>

              <section className="glass-surface px-7 py-6">
                <h2 className="text-2xl text-foreground">Loaded before the call starts</h2>
                <ul className="mt-5 space-y-3.5 text-lg">
                  <li className="rounded-2xl bg-muted/60 px-5 py-4">
                    <span className="font-semibold text-foreground">Halvorsen Pumps</span>
                    <span className="text-muted-foreground"> · Q3 results are not public until Dec 2.</span>
                  </li>
                  <li className="rounded-2xl bg-muted/60 px-5 py-4">
                    <span className="font-semibold text-foreground">Public Q2 filing</span>
                    <span className="text-muted-foreground"> · Total company orders were down 8%.</span>
                  </li>
                  <li className="rounded-2xl bg-muted/60 px-5 py-4">
                    <span className="font-semibold text-foreground">Ray Castellano</span>
                    <span className="text-muted-foreground"> · Former Sales VP who left 3 months ago.</span>
                  </li>
                </ul>
              </section>
            </div>
          )}

          {stage === "call" && (
            <div className="space-y-5">
              <section className="glass-surface px-7 py-5" data-demo="live-room">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div data-demo="pill">
                    <p className="mb-1.5 text-base text-muted-foreground">What Priya sees during the call</p>
                    <div className="live-pill" data-level={snap.pill.level} data-testid="demo-live-pill">
                      <span className="live-pill-dot" aria-hidden />
                      <span className="text-lg font-medium text-foreground">{snap.pill.text}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" onClick={togglePlay} data-testid="play-call">
                      {playing ? "Pause" : effectiveTime > 0.5 && effectiveTime < CALL_DURATION - 0.5 ? "Resume" : "Play call"}
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
                  <h2 className="text-xl text-foreground">Call audio & transcript</h2>

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
                              <span className="font-medium text-foreground">
                                {turn.speaker === "analyst" ? "Priya · Banker" : "Ray · Expert"}
                              </span>
                              {showFlag && turn.flagNote && (
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
                              )}
                            </div>

                            <p className="mt-1.5 text-lg leading-snug">
                              {turn.words.map(([word, ws, we], idx) => {
                                const spoken = effectiveTime >= ws;
                                const now = playing && effectiveTime >= ws && effectiveTime <= we + 0.08;
                                return (
                                  <span
                                    key={idx}
                                    className={
                                      now
                                        ? "word-now"
                                        : spoken || (reached && !playing && effectiveTime >= turn.end - 0.4)
                                          ? "word-spoken"
                                          : "word-upcoming"
                                    }
                                  >
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
                    <h2 className="text-xl text-foreground">What Blink checks</h2>
                    <SlidingTabs
                      options={ENGINE_TABS}
                      value={engineTab}
                      onChange={(next) => setManualEngineTab(next)}
                      ariaLabel="Engine view mode"
                    />
                  </div>

                  <div className="mt-4 rounded-2xl bg-muted/60 px-5 py-4">
                    <p className="text-xl font-medium leading-snug text-foreground">{snap.headline}</p>
                    <p className="mt-2 text-lg leading-snug text-muted-foreground">{snap.summary}</p>
                  </div>

                  {engineTab === "simple" ? (
                    <div className="mt-4 space-y-4">
                      {snap.filing && (
                        <div className="fsm-box">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-lg font-medium text-foreground">Public filing check</span>
                            <span className={snap.filing.outcome === "mismatch" ? "font-semibold text-destructive" : "font-semibold text-success"}>
                              {snap.filing.outcome === "mismatch" ? "Does not match filing" : "Matches public report"}
                            </span>
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-xl bg-muted/70 px-4 py-3">
                              <p className="text-base text-muted-foreground">What Ray said</p>
                              <p className="mt-1 text-lg font-medium text-foreground">{snap.filing.expertSummary}</p>
                            </div>
                            <div className="rounded-xl bg-muted/70 px-4 py-3">
                              <p className="text-base text-muted-foreground">{snap.filing.docTitle}</p>
                              <p className="mt-1 text-lg font-medium text-foreground">{snap.filing.filedSummary}</p>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="fsm-box">
                        <p className="text-lg font-medium text-foreground">Active policy rules</p>
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
                                <span className="text-base font-medium text-foreground">{m.title}</span>
                                <span className={`mt-1 text-base font-medium ${tone}`}>
                                  {m.state === "ESCALATION_REQUESTED"
                                    ? "Escalated"
                                    : m.state === "REVIEW_REQUIRED"
                                      ? "Flagged"
                                      : m.state === "NEEDS_CONTEXT"
                                        ? "Needs context"
                                        : m.state === "NOT_TRIGGERED"
                                          ? "Safe"
                                          : "Listening"}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {effectiveTime >= 42 && (
                        <div className="pt-1">
                          <Button
                            type="button"
                            onClick={() => {
                              audioRef.current?.pause();
                              setManualStage("review");
                            }}
                          >
                            Review flagged quote as compliance
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="mt-4 space-y-4">
                      <div>
                        <SlidingTabs
                          options={MONITOR_TABS}
                          value={activeMonitorId}
                          onChange={(next) => setManualMonitor(next)}
                          ariaLabel="Select policy rule"
                        />
                      </div>

                      <FsmDiagram monitor={activeMonitor} />
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
                  <span className="text-base text-muted-foreground">Compliance review</span>
                  <span className="font-medium text-destructive">{sealed ? "Kept hidden" : "Flagged for review"}</span>
                </div>
                <h2 className="mt-1 text-2xl text-foreground">Hide this passage from the banker?</h2>
                <p className="mt-2 text-lg leading-snug text-muted-foreground">
                  Blink hid these lines when the call ended. A compliance officer makes the final call.
                </p>

                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl bg-muted/60 px-5 py-4">
                    <p className="text-base text-muted-foreground">Earlier in the call</p>
                    <p className="mt-1 text-lg text-foreground">
                      “Honestly, orders fell off a cliff in September... restocking is down roughly twenty percent.”
                    </p>
                  </div>
                  <div className="rounded-2xl bg-muted/60 px-5 py-4">
                    <p className="text-base text-muted-foreground">When asked where the 20% figure came from</p>
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
                      Keep hidden from banker
                    </Button>
                  ) : (
                    <>
                      <span className="sealed-bar text-base">Hidden from banker</span>
                      <Button type="button" onClick={() => setManualStage("brief")}>
                        See the banker&apos;s brief
                      </Button>
                    </>
                  )}
                </div>
              </section>

              <section className="glass-surface px-7 py-6">
                <h2 className="text-2xl text-foreground">Why Blink flagged it</h2>
                <div className="fsm-box mt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-muted/60 px-4 py-3 text-base">
                      <p className="text-muted-foreground">What Ray said</p>
                      <p className="mt-1 text-lg font-medium text-foreground">{mismatchFiling.expertSummary}</p>
                    </div>
                    <div className="rounded-xl bg-muted/60 px-4 py-3 text-base">
                      <p className="text-muted-foreground">{mismatchFiling.docTitle}</p>
                      <p className="mt-1 text-lg font-medium text-foreground">{mismatchFiling.filedSummary}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <FsmDiagram monitor={escalatedMonitor} />
                </div>
              </section>
            </div>
          )}

          {stage === "brief" && (
            <div className="grid items-start gap-5 lg:grid-cols-2" data-demo="note">
              <section className="glass-surface px-7 py-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base text-muted-foreground">Sent to Priya Raman</span>
                  <span className="font-medium text-success">Safe to share</span>
                </div>
                <h2 className="mt-1 text-2xl text-foreground">Research brief · Halvorsen Pumps</h2>

                <div className="mt-5 space-y-4 rounded-2xl bg-muted/60 px-6 py-5 text-lg leading-relaxed text-foreground">
                  <p>
                    Industrial pump distributors are working through prior-year inventory overhang, softening near-term restocking across the channel.
                  </p>
                  <p>
                    Published trade reports show hot-rolled steel up roughly 12% over the past six months, while manufacturers have pushed through two catalog price increases this year{" "}
                    <button
                      type="button"
                      onClick={() => setSelectedCitation((v) => !v)}
                      className="glass-press rounded-full bg-secondary px-3.5 py-0.5 text-base font-medium text-foreground"
                    >
                      View source quote
                    </button>
                    .
                  </p>
                </div>

                {selectedCitation && (
                  <div className="fsm-box mt-4 text-lg">
                    <p className="text-foreground">
                      “From the public trade press, hot-rolled steel is up around twelve percent over six months, though most manufacturers pushed through two catalog price increases this year.”
                    </p>
                  </div>
                )}

                <p className="mt-4 text-lg text-muted-foreground">
                  The 19.8% Q3 number and the Salesforce login were kept out of this brief.
                </p>
              </section>

              <section className="glass-surface px-7 py-6">
                <h2 className="text-2xl text-foreground">Transcript sent to Priya</h2>
                <p className="mt-1 text-lg text-muted-foreground">Restricted lines are replaced with blank bars.</p>

                <ol className="mt-4 space-y-3 text-base">
                  {TURNS.map((t) => {
                    const hidden = t.id === "T4" || t.id === "T5" || t.id === "T6";
                    return (
                      <li key={t.id} className="rounded-2xl bg-muted/60 px-4 py-3">
                        <div className="font-medium text-foreground">
                          {t.speaker === "analyst" ? "Priya · Banker" : "Ray · Expert"}
                        </div>
                        {hidden ? (
                          <div className="mt-2">
                            <span className="sealed-bar" aria-label="Hidden by compliance">
                              Hidden by compliance
                            </span>
                          </div>
                        ) : (
                          <p className="mt-1.5 text-lg leading-snug text-foreground">{t.text}</p>
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
