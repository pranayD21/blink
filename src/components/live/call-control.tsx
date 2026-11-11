"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusDot, type DotTone } from "@/components/app/status-dot";
import { AgentTrace, type AgentBeat } from "@/components/live/agent-trace";
import type { FsmState, KleeneVal, MonitorSnapshot } from "@/components/trial/call-data";
import { FsmDiagram } from "@/components/trial/fsm-diagram";
import { SlidingTabs } from "@/components/trial/sliding-tabs";
import { Button } from "@/components/ui/button";
import type { PillView } from "@/core/live/client";
import { STAGES, type Stage } from "@/core/live/health";
import type { Channel } from "@/core/live/turns";
import { api, errorMessage } from "@/lib/api";
import type { ControlSource } from "@/lib/live/control-source";
import { type ScriptTurn, scriptTurnSource } from "@/lib/live/script-source";
import { type LiveMonitorTelemetry, type TurnReply, type TurnSource, liveTurnSource, runCall } from "@/lib/live/session";

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

type Phase = "idle" | "starting" | "live" | "stopping" | "ended";
type AudioMode = "solo" | "two_channel";
type EngineTab = "simple" | "fsm";

const STAGE_LABEL: Record<Stage, string> = {
  hearing: "Hearing",
  transcribing: "Transcribing",
  reading: "Reading",
  rules: "Rules",
  screen: "Screen",
};

const PHASE_LINE: Record<Exclude<Phase, "ended">, string> = {
  idle: "Pick the case and press Start when the call begins.",
  starting: "Starting the call…",
  live: "Blink is listening. Press Stop when the call is over.",
  stopping: "Ending the call…",
};

const AUDIO_MODE_TABS = [
  { value: "solo", label: "Solo mic" },
  { value: "two_channel", label: "Two-person call" },
] as const;

const SPEAKER_TABS = [
  { value: "expert", label: "Speak as Expert" },
  { value: "analyst", label: "Speak as Banker" },
] as const;

const ENGINE_TABS = [
  { value: "simple", label: "Summary" },
  { value: "fsm", label: "State machine" },
] as const;

type LiveRuleId = "M1" | "M2" | "M3" | "M4";

const MONITOR_TABS: readonly { value: LiveRuleId; label: string }[] = [
  { value: "M1", label: "Rule 1" },
  { value: "M2", label: "Rule 2" },
  { value: "M3", label: "Rule 3" },
  { value: "M4", label: "Rule 4" },
];

const HALVORSEN_SAMPLE_VALUE = "__halvorsen_sample__";

/** Creates a realistic Halvorsen Pumps case packet matched to the curated 10-Q filings. */
const HALVORSEN_QUICK_CASE = () => ({
  title: "Halvorsen Pumps — live check",
  issuer: "Halvorsen Pumps, Inc.",
  ticker: "HLVP",
  aliases: ["Halvorsen", "HLVP", "Halvorsen Pumps"],
  issuer_fiscal: {
    fiscal_year_end_month: 1,
    fiscal_quarters_note: "FY2027 runs Feb 1 2026 – Jan 31 2027. Q1 Feb–Apr, Q2 May–Jul, Q3 Aug–Oct.",
    last_reported: { fy: 2027, q: 2 as const, reported_on: "2026-09-08" },
    next_report_expected: "2026-12-02",
  },
  call_date: "2026-11-03",
  research_questions: [
    "How is distributor demand for industrial pumps trending into year-end?",
    "How are input costs affecting pump manufacturers?",
  ],
  analyst_notes: "Live compliance check.",
  expert: {
    name: "R. Castellano",
    current_employer: "Independent consultant",
    current_title: "Advisor, industrial distribution",
    employment: [{ employer: "Halvorsen Pumps, Inc.", title: "Regional Sales Director, West", start: "2019-03-01", end: "2026-07-15" }],
    network: "Meridian Expert Network",
    network_attestation: { no_current_confidentiality_conflicts: true, signed_on: "2026-10-30" },
  },
});

const PRED_LABEL: Record<string, string> = {
  about_covered_issuer: "About covered company",
  company_specific_operating_metric: "Shares a company figure",
  internal_source_claimed: "From an internal system",
  post_employment_access: "Used former employer login",
  expert_recent_issuer_employee: "Left company within 12 months",
  current_or_unreported_period: "Unreported quarter",
  public_match_verified: "Verified in public filings",
  nonpublic_corporate_event: "Unannounced company event",
  confidentiality_signal_present: "Marked confidential",
  analyst_solicited: "Solicited by banker",
};

type LiveMonitorSnap = Omit<MonitorSnapshot, "id"> & { id: LiveRuleId };

const initialMonitors = (): Record<LiveRuleId, LiveMonitorSnap> => ({
  M1: {
    id: "M1",
    title: "Internal data",
    ruleSummary: "Flags company figures attributed to internal systems or staff.",
    terminalState: "REVIEW_REQUIRED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    guardResult: "indeterminate",
    conditions: [
      { label: "About covered company", answer: "Listening", tri: "indeterminate" },
      { label: "Shares a company figure", answer: "Listening", tri: "indeterminate" },
      { label: "From an internal system", answer: "Listening", tri: "indeterminate" },
    ],
  },
  M2: {
    id: "M2",
    title: "Former login",
    ruleSummary: "Escalates if an expert uses a former employer's internal systems.",
    terminalState: "ESCALATION_REQUESTED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    guardResult: "indeterminate",
    conditions: [
      { label: "Used former employer login", answer: "Listening", tri: "indeterminate" },
      { label: "From an internal system", answer: "Listening", tri: "indeterminate" },
    ],
  },
  M3: {
    id: "M3",
    title: "Confidential event",
    ruleSummary: "Flags unannounced company events or solicited nonpublic details.",
    terminalState: "REVIEW_REQUIRED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    guardResult: "indeterminate",
    conditions: [
      { label: "About covered company", answer: "Listening", tri: "indeterminate" },
      { label: "Unannounced company event", answer: "Listening", tri: "indeterminate" },
    ],
  },
  M4: {
    id: "M4",
    title: "Recent exit",
    ruleSummary: "Flags unreported numbers from anyone who left within 12 months.",
    terminalState: "REVIEW_REQUIRED",
    state: "UNASSESSED",
    prevState: null,
    edgeResult: null,
    guardResult: "indeterminate",
    conditions: [
      { label: "Left company within 12 months", answer: "Listening", tri: "indeterminate" },
      { label: "About covered company", answer: "Listening", tri: "indeterminate" },
      { label: "Unreported quarter", answer: "Listening", tri: "indeterminate" },
      { label: "Verified in public filings", answer: "Listening", tri: "indeterminate" },
    ],
  },
});

function toFsmState(s: string): FsmState {
  if (s === "NEEDS_CONTEXT" || s === "NOT_TRIGGERED" || s === "REVIEW_REQUIRED" || s === "ESCALATION_REQUESTED") return s;
  return "UNASSESSED";
}

function mergeTelemetry(
  prev: Record<LiveRuleId, LiveMonitorSnap>,
  incoming: readonly LiveMonitorTelemetry[],
): { next: Record<LiveRuleId, LiveMonitorSnap>; focus: LiveRuleId | null } {
  const next = { ...prev };
  let focus: LiveRuleId | null = null;
  let topRank = 0;

  for (const item of incoming) {
    const id = (
      item.monitorId === "M1" || item.monitorId === "M2" || item.monitorId === "M3" || item.monitorId === "M4"
        ? item.monitorId
        : null
    ) as LiveRuleId | null;
    if (!id) continue;
    const cur = next[id];
    const nextState = toFsmState(item.nextState);
    const prevState = toFsmState(item.prevState);
    const terminalState = nextState === "ESCALATION_REQUESTED" ? "ESCALATION_REQUESTED" : cur.terminalState;
    const rank = nextState === "ESCALATION_REQUESTED" ? 4 : nextState === "REVIEW_REQUIRED" ? 3 : nextState === "NEEDS_CONTEXT" ? 2 : 1;
    if (rank > topRank) {
      topRank = rank;
      focus = id;
    }
    const conditions =
      item.predicates.length > 0
        ? item.predicates.map((p) => {
            if (p.name === "public_match_verified") {
              const tri: KleeneVal = p.tri === "false" ? "true" : p.tri === "true" ? "false" : "indeterminate";
              const answer = p.tri === "true" ? "Yes" : p.tri === "false" ? "No" : "Unclear";
              return { label: PRED_LABEL[p.name] ?? p.name, answer, tri };
            }
            return {
              label: PRED_LABEL[p.name] ?? p.name,
              answer: p.tri === "true" ? "Yes" : p.tri === "false" ? "No" : "Unclear",
              tri: p.tri,
            };
          })
        : cur.conditions;

    next[id] = {
      ...cur,
      terminalState,
      state: nextState,
      prevState: prevState === nextState ? cur.prevState : prevState,
      edgeResult: prevState === nextState ? cur.edgeResult : item.result,
      guardResult: item.result,
      conditions,
    };
  }
  return { next, focus };
}

const isLegacyPlaceholder = (c: ControlCase) => c.ticker === "LIVE" && c.issuer === "The company on this call";

export function CallControl({
  banker,
  cases,
  source,
  hero = false,
  hasActivePolicy = true,
}: {
  banker: string;
  cases: ControlCase[];
  source: ControlSource;
  hero?: boolean;
  hasActivePolicy?: boolean;
}) {
  const router = useRouter();
  const realCases = cases.filter((c) => !isLegacyPlaceholder(c));
  const [selectedChoice, setSelectedChoice] = useState<string>(() => realCases[0]?.id ?? HALVORSEN_SAMPLE_VALUE);
  const [audioMode, setAudioMode] = useState<AudioMode>(() =>
    typeof window !== "undefined" && window.blinkDesktop?.isDesktop ? "two_channel" : "solo",
  );
  const [soloRole, setSoloRole] = useState<Channel>("expert");
  const soloRoleRef = useRef<Channel>("expert");

  const [phase, setPhase] = useState<Phase>("idle");
  const [activeCase, setActiveCase] = useState<string | null>(null);
  const [lastCaseId, setLastCaseId] = useState<string | null>(null);
  const [pillView, setPillView] = useState<PillView>({ level: "idle", text: "Ready" });
  const [down, setDown] = useState<ReadonlySet<Stage>>(new Set());
  const [endedText, setEndedText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [beats, setBeats] = useState<AgentBeat[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [voicePeak, setVoicePeak] = useState(0);
  const [engineTab, setEngineTab] = useState<EngineTab>("simple");
  const [monitors, setMonitors] = useState<Record<LiveRuleId, LiveMonitorSnap>>(initialMonitors);
  const [selectedMonitor, setSelectedMonitor] = useState<LiveRuleId>("M4");

  const channel = useRef<BroadcastChannel | null>(null);
  const call = useRef<{ end(): Promise<void> } | null>(null);
  const stopping = useRef(false);

  useEffect(() => {
    soloRoleRef.current = soloRole;
  }, [soloRole]);

  useEffect(() => {
    channel.current = new BroadcastChannel("blink-pill");
    return () => {
      channel.current?.close();
      channel.current = null;
      void call.current?.end().catch(() => undefined);
    };
  }, []);

  const show = (view: PillView) => {
    setPillView(view);
    channel.current?.postMessage(view);
    window.blinkDesktop?.setPillVisible(view.level !== "idle");
    if (view.level === "ended") setEndedText(view.text);
    if (view.level === "ended" || view.level === "broken") {
      const tone: AgentBeat["tone"] = view.level === "broken" ? "warn" : "quiet";
      setBeats((prev) => [...prev, { text: view.text, tone }].slice(-40));
    }
  };

  const onStage = (stage: Stage, up: boolean) =>
    setDown((prev) => {
      const next = new Set(prev);
      if (up) next.delete(stage);
      else next.add(stage);
      return next;
    });

  const onDecision = (reply: TurnReply) => {
    setTurnCount((n) => Math.max(n, reply.seq));
    if (reply.monitors && reply.monitors.length > 0) {
      setMonitors((prev) => {
        const { next, focus } = mergeTelemetry(prev, reply.monitors!);
        if (focus) setSelectedMonitor(focus);
        return next;
      });
    }
  };

  const stop = async () => {
    const current = call.current;
    if (!current || stopping.current) return;
    stopping.current = true;
    setPhase("stopping");
    try {
      await current.end();
      call.current = null;
      setDown(new Set());
      setVoicePeak(0);
      setActiveCase(null);
      setPhase("ended");
      router.refresh();
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
    setBeats([]);
    setTurnCount(0);
    setVoicePeak(0);
    setMonitors(initialMonitors());
    setDown(new Set());
    setActiveCase(caseId);
    setLastCaseId(caseId);
    setPhase("starting");
    try {
      let turns: TurnSource | ((callId: string) => TurnSource);
      let scriptDone: Promise<void> | null = null;
      if (source.kind === "script") {
        const script = scriptTurnSource((await api<{ turns: ScriptTurn[] }>("/api/dev/script-turns")).turns, source.paceMs);
        scriptDone = script.done;
        turns = script;
      } else if (hero) {
        turns = (callId) =>
          liveTurnSource(callId, {
            mode: audioMode,
            soloSpeaker: () => soloRoleRef.current,
            onAudioLevel: (peak) => setVoicePeak((prev) => Math.max(peak, prev * 0.78)),
          });
      } else {
        turns = (callId) => liveTurnSource(callId);
      }
      window.blinkDesktop?.setPillVisible(true);
      call.current = await runCall({
        caseId,
        source: turns,
        onView: show,
        onStage,
        onBeat: (beat) => setBeats((prev) => [...prev, beat].slice(-40)),
        onDecision,
        turnDeadlineMs: hero ? 10_000 : undefined,
      });
      setPhase("live");
      if (scriptDone) void scriptDone.then(stop);
    } catch (err) {
      call.current = null;
      window.blinkDesktop?.setPillVisible(false);
      setActiveCase(null);
      setVoicePeak(0);
      setPhase("idle");
      setError(`The call could not start: ${errorMessage(err)}`);
    }
  };

  const startSelected = async () => {
    try {
      let caseId = selectedChoice;
      if (caseId === HALVORSEN_SAMPLE_VALUE || !cases.some((c) => c.id === caseId)) {
        const created = await api<{ caseId: string }>("/api/cases", { body: HALVORSEN_QUICK_CASE() });
        caseId = created.caseId;
      }
      await start(caseId);
    } catch (err) {
      setError(`The call could not start: ${errorMessage(err)}`);
      setPhase("idle");
    }
  };

  const busy = phase === "starting" || phase === "live" || phase === "stopping";
  const tone = (stage: Stage): DotTone => (!busy ? "none" : down.has(stage) ? "warn" : "good");

  if (hero) {
    const selectedCaseObj = realCases.find((c) => c.id === selectedChoice);
    const isHalvorsen = !selectedCaseObj || selectedCaseObj.ticker === "HLVP";
    const pillLevel =
      phase === "idle" || phase === "starting"
        ? "idle"
        : pillView.level === "broken"
          ? "amber"
          : pillView.level === "ended"
            ? "idle"
            : pillView.level;
    const pillLabel =
      phase === "starting"
        ? "Connecting audio…"
        : phase === "idle"
          ? "Ready to listen"
          : pillView.text || "Listening";

    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl text-foreground">Live call</h1>
            <select
              value={selectedChoice}
              disabled={busy}
              onChange={(e) => setSelectedChoice(e.target.value)}
              aria-label="Case for this call"
              className="glass-field h-10 rounded-full px-4 text-base text-foreground outline-none disabled:opacity-50"
              data-testid="call-case-select"
            >
              {realCases.map((c) => (
                <option key={c.id} value={c.id} className="bg-popover text-popover-foreground">
                  {c.title} ({c.ticker})
                </option>
              ))}
              <option value={HALVORSEN_SAMPLE_VALUE} className="bg-popover text-popover-foreground">
                + Halvorsen Pumps sample packet (HLVP)
              </option>
            </select>
            {!busy && (
              <Link href="/cases/new" className="glass-press text-base text-muted-foreground hover:text-foreground">
                + Custom case
              </Link>
            )}
          </div>

          {!busy && (
            <SlidingTabs
              options={AUDIO_MODE_TABS}
              value={audioMode}
              onChange={setAudioMode}
              ariaLabel="Audio input mode"
            />
          )}
        </header>

        {!hasActivePolicy && (
          <div className="glass-surface flex flex-wrap items-center justify-between gap-4 px-7 py-5 text-base">
            <span className="text-foreground">No compliance policy is active yet. Approve a policy version first so Blink has rules to check.</span>
            <Button asChild className="h-10 px-5">
              <Link href="/policies">Open Policy</Link>
            </Button>
          </div>
        )}

        <section className="glass-surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b px-8 py-6">
            <div className="live-pill" data-level={pillLevel} data-testid="live-pill">
              <span className="live-pill-dot" aria-hidden />
              <span className="text-lg font-medium text-foreground">{pillLabel}</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {busy && audioMode === "solo" && (
                <SlidingTabs
                  options={SPEAKER_TABS}
                  value={soloRole}
                  onChange={setSoloRole}
                  ariaLabel="Active speaker role"
                />
              )}

              {phase === "live" || phase === "stopping" ? (
                <Button data-testid="stop-call" disabled={phase !== "live"} onClick={() => void stop()}>
                  {phase === "stopping" ? "Ending…" : "Stop call"}
                </Button>
              ) : (
                <Button
                  className="h-12 px-8 text-base"
                  data-testid="start-call"
                  disabled={phase === "starting" || !hasActivePolicy}
                  onClick={() => void startSelected()}
                >
                  {phase === "starting" ? "Starting…" : "Start call"}
                </Button>
              )}
            </div>
          </div>

          <div className="grid divide-y lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="flex flex-col justify-between space-y-6 px-8 py-8">
              <div className="space-y-5">
                <div className="flex items-center justify-between text-base">
                  <span className="text-muted-foreground">
                    {audioMode === "solo" ? `Solo mic · speaking as ${soloRole === "expert" ? "Expert" : "Banker"}` : "Mic (Banker) + Tab audio (Expert)"}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {turnCount} {turnCount === 1 ? "turn" : "turns"} checked
                  </span>
                </div>

                <div className="call-track" aria-hidden>
                  <div
                    className="call-track-fill"
                    style={{ width: `${busy ? Math.min(100, Math.max(4, Math.round(voicePeak * 320))) : 0}%` }}
                  />
                </div>

                {isHalvorsen ? (
                  <div className="space-y-2 pt-2">
                    <p className="text-sm font-medium text-muted-foreground">Try saying into your mic</p>
                    {soloRole === "analyst" && audioMode === "solo" ? (
                      <p className="text-lg leading-relaxed text-foreground">
                        “Are Halvorsen&apos;s own third-quarter bookings tracking down twenty percent right now?”
                      </p>
                    ) : (
                      <p className="text-lg leading-relaxed text-foreground">
                        “I left Halvorsen in July. My old Salesforce login still works, and Q3 bookings were down twenty percent last week.”
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="pt-2 text-lg leading-relaxed text-muted-foreground">
                    Speak naturally. Blink checks each finished sentence against the policy and hides transcript text until compliance reviews the call.
                  </p>
                )}
              </div>

              {phase === "ended" && (
                <div className="space-y-3 border-t pt-5">
                  <p className="text-lg font-medium text-foreground" data-testid="call-ended">
                    {endedText ?? "Call ended."}
                  </p>
                  {lastCaseId && (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button asChild variant="outline">
                        <Link href={`/cases/${lastCaseId}`}>Open case &amp; review status</Link>
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {error && (
                <p className="text-base text-destructive" role="alert" data-testid="call-error">
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-col justify-between space-y-6 px-8 py-8">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SlidingTabs
                    options={ENGINE_TABS}
                    value={engineTab}
                    onChange={setEngineTab}
                    ariaLabel="Engine view mode"
                  />
                </div>

                {engineTab === "simple" ? (
                  <div className="mt-6 space-y-4">
                    {beats.length === 0 ? (
                      <div data-testid="agent-trace">
                        <h2 className="text-2xl font-medium text-foreground">
                          {busy ? "Listening for a finished sentence" : "Waiting for the call to start"}
                        </h2>
                        <p className="mt-2 text-lg leading-relaxed text-muted-foreground">
                          {audioMode === "solo"
                            ? "Uses only your microphone. Pause briefly at the end of a sentence so Blink can check it."
                            : "Shares your microphone as the banker and a browser tab or window for the expert."}
                        </p>
                      </div>
                    ) : (
                      <AgentTrace beats={beats} />
                    )}
                  </div>
                ) : (
                  <div className="mt-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-xl font-medium text-foreground">{monitors[selectedMonitor].title}</h2>
                      <div className="flex items-center gap-1.5 text-sm">
                        {MONITOR_TABS.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => setSelectedMonitor(m.value)}
                            className={
                              m.value === selectedMonitor
                                ? "rounded-full bg-secondary px-3 py-1 font-medium text-foreground"
                                : "rounded-full px-3 py-1 text-muted-foreground hover:text-foreground"
                            }
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <FsmDiagram monitor={monitors[selectedMonitor]} />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t pt-4 text-sm text-muted-foreground" data-testid="stages">
                {STAGES.map((stage) => (
                  <StatusDot key={stage} tone={tone(stage)} data-testid={`stage-${stage}`} data-up={busy ? String(!down.has(stage)) : undefined}>
                    {STAGE_LABEL[stage]}
                  </StatusDot>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 p-5 text-sm">
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
                <Button data-testid={`start-call-${c.id}`} disabled={busy} onClick={() => void start(c.id)}>
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
      <AgentTrace beats={beats} />
    </main>
  );
}
