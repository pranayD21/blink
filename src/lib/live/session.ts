/**
 * A live call in the banker's app: where turns come from (`TurnSource`), the live source built on
 * the two audio channels and Flux, and `runCall`, which sends turns to the server in order and
 * drives the pill from the replies. Everything that can be decided without a browser lives in
 * `src/core/live/` (turns.ts, client.ts); this file only wires it to the clock and the network.
 */
import { type ClientEvent, INITIAL_CLIENT, type PillView, reduceClient } from "@/core/live/client";
import { parseFluxMessage, type FluxEvent } from "@/core/live/flux";
import type { Stage } from "@/core/live/health";
import { BROKEN_AFTER_MS, type PillLevel } from "@/core/live/pill";
import { type Channel, type FinishedTurn, createHearingWatch, createTurnAssembler } from "@/core/live/turns";
import { ApiError, api } from "@/lib/api";
import type { LiveMonitorTelemetry } from "@/server/services/live";
import { type AudioChannels, captureChannels, captureMicrophone } from "./audio";
import { RECONNECT_FIRST_MS, RECONNECT_MAX_MS, openFlux } from "./flux-client";

export type { FinishedTurn } from "@/core/live/turns";
export type { LiveMonitorTelemetry } from "@/server/services/live";

/**
 * Where a call's turns come from. A turn's `speechStartMs`/`speechEndMs` count from the moment
 * `start()` was called (the session takes that moment as the call's audio origin);
 * `transcribedAtMs` is wall-clock time. `onStage` reports a stage going down (with a cause the
 * banker may read: never transcript text) and coming back.
 */
export interface TurnSource {
  start(onTurn: (t: FinishedTurn) => void, onStage: (stage: Stage, up: boolean, cause?: string) => void): Promise<void>;
  stop(): void;
}

// ── The live source ─────────────────────────────────────────────────────────

/** One stage fed by several independent parts: down while any part is down, up when all are back. */
function stageGroup(stage: Stage, report: (stage: Stage, up: boolean, cause?: string) => void) {
  const down = new Map<string, string>();
  return (part: string, up: boolean, cause?: string) => {
    const wasDown = down.size > 0;
    if (up) down.delete(part);
    else if (!down.has(part)) down.set(part, cause ?? `${part} stopped`);
    if (!wasDown && down.size > 0) report(stage, false, down.get(part));
    else if (wasDown && down.size === 0) report(stage, true);
  };
}

/** Moves a Flux event's audio window from its socket's clock onto the call clock. */
function onCallClock(event: FluxEvent, shiftMs: number): FluxEvent {
  if (event.kind !== "end" && event.kind !== "eager_end") return event;
  return { ...event, audioStartMs: event.audioStartMs + shiftMs, audioEndMs: event.audioEndMs + shiftMs };
}

const CHANNEL_NAME: Record<Channel, string> = { analyst: "microphone", expert: "computer audio" };

export interface LiveTurnSourceOptions {
  /** "solo" uses only the microphone so one person can test both sides in a browser. */
  mode?: "two_channel" | "solo";
  /** In solo mode, which role the microphone is speaking as right now. */
  soloSpeaker?: () => Channel;
  /** Peak audio level (0..1) for the live voice meter. */
  onAudioLevel?: (peak: number) => void;
  /** Digital-zero system-audio watch (enabled on Mac desktop loopback and in node tests). */
  watchSystemSilence?: boolean;
}

/** The banker's microphone and (in two_channel mode) the computer's audio, through Flux. */
export function liveTurnSource(callId: string, opts: LiveTurnSourceOptions = {}): TurnSource {
  let stopped = false;
  let channels: { stop(): void } | null = null;
  const sockets: { close(): void }[] = [];
  const mint = async () => (await api<{ accessToken: string }>(`/api/calls/${encodeURIComponent(callId)}/stt-token`, { body: {} })).accessToken;
  const mode = opts.mode ?? "two_channel";
  const watchSilence =
    opts.watchSystemSilence ??
    (typeof window === "undefined" || Boolean((window as { blinkDesktop?: { isDesktop?: boolean } }).blinkDesktop?.isDesktop));

  const stop = () => {
    stopped = true;
    // Closing asks Flux for its last turns; they still reach onTurn until each socket closes.
    sockets.splice(0).forEach((s) => s.close());
    channels?.stop();
    channels = null;
  };

  return {
    async start(onTurn, onStage) {
      const originMs = Date.now();
      const report = (stage: Stage, up: boolean, cause?: string) => {
        if (!stopped) onStage(stage, up, cause);
      };
      const hearing = stageGroup("hearing", report);
      const transcribing = stageGroup("transcribing", report);
      const assembler = createTurnAssembler();
      const watch = createHearingWatch();

      try {
        if (mode === "solo") {
          const mic = await captureMicrophone();
          channels = { stop: () => mic.getTracks().forEach((t) => t.stop()) };
          if (stopped) return stop();
          for (const track of mic.getAudioTracks()) {
            const check = () => {
              if (track.readyState === "ended") hearing("analyst-track", false, "the microphone track ended");
            };
            track.addEventListener("ended", check);
            check();
          }
          const token = await mint();
          if (stopped) return stop();
          sockets.push(
            openFlux(
              token,
              mic,
              (raw, atMs, audioStartedAtMs) => {
                const event = onCallClock(parseFluxMessage(raw), audioStartedAtMs - originMs);
                const speaker = opts.soloSpeaker ? opts.soloSpeaker() : "expert";
                for (const turn of assembler.push({ channel: speaker, event, atMs })) onTurn(turn);
              },
              (up, cause) => transcribing("analyst", up, cause && `microphone: ${cause}`),
              {
                mint,
                onAudioFailed: (cause) => hearing("analyst-audio", false, `microphone: ${cause}`),
                onLevel: (peak) => opts.onAudioLevel?.(peak),
              },
            ),
          );
          return;
        }

        const captured: AudioChannels = await captureChannels();
        channels = captured;
        if (stopped) return stop();
        for (const channel of ["analyst", "expert"] as const) {
          const stream = captured[channel];
          for (const track of stream.getAudioTracks()) {
            const check = () => {
              if (track.readyState === "ended") hearing(`${channel}-track`, false, `the ${CHANNEL_NAME[channel]} track ended`);
            };
            track.addEventListener("ended", check);
            check();
          }
          const token = await mint();
          if (stopped) return stop();
          sockets.push(
            openFlux(
              token,
              stream,
              (raw, atMs, audioStartedAtMs) => {
                const event = onCallClock(parseFluxMessage(raw), audioStartedAtMs - originMs);
                for (const turn of assembler.push({ channel, event, atMs })) onTurn(turn);
              },
              (up, cause) => transcribing(channel, up, cause && `${CHANNEL_NAME[channel]}: ${cause}`),
              {
                mint,
                // A dead audio pipeline is its own part of hearing, so no socket event can clear it.
                onAudioFailed: (cause) => hearing(`${channel}-audio`, false, `${CHANNEL_NAME[channel]}: ${cause}`),
                onLevel: (peak, atMs) => {
                  opts.onAudioLevel?.(peak);
                  if (!watchSilence) return;
                  const change = watch.push({ channel, peak, atMs });
                  if (change) hearing("computer-audio-silent", change === "up", "the computer's audio has been perfectly silent for 3 s while the microphone heard speech");
                },
              },
            ),
          );
        }
      } catch (err) {
        stop();
        throw err;
      }
    },
    stop,
  };
}

// ── The call session ────────────────────────────────────────────────────────

/** A turn request slower than this marks reading down and is sent again. */
export const TURN_DEADLINE_MS = 3000;
export const TICK_MS = 250;
/** After the source stops, how long its last turns have to arrive (Flux flushes on CloseStream). */
export const END_FLUSH_MS = 2000;
/** At most this long, at the end, for turns already queued to get through. */
export const END_DRAIN_MS = 5000;

interface TurnBody {
  seq: number;
  speaker: Channel;
  text: string;
  speechStartMs: number;
  speechEndMs: number;
  speechEndedAt: string;
  transcribedAt: string;
}

export interface TurnReply {
  seq: number;
  pill: { level: PillLevel; text: string };
  note?: string;
  monitors?: LiveMonitorTelemetry[];
}

export interface AgentBeat {
  text: string;
  tone: "quiet" | "work" | "warn" | "stop";
}

interface OpenOutage {
  startedAtMs: number;
  cause: string;
  shownToBanker: boolean;
}

const LEVELS: readonly string[] = ["listening", "amber", "red"];

const iso = (ms: number) => new Date(ms).toISOString();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const clockMs = (ms: number) => Math.max(0, Math.round(ms));
/** Worth sending again: the network, a timeout, a rate limit or the server's own failure. Anything else will fail the same way. */
const retryable = (err: unknown) => !(err instanceof ApiError) || err.status === 0 || err.status === 408 || err.status === 429 || err.status >= 500;
const describe = (err: unknown) => (err instanceof ApiError ? (err.status === 0 ? "the server could not be reached" : `the server answered ${err.status} (${err.code})`) : "the request failed");
/** Whether the server can still take an outage after this refusal: not when it no longer knows the banker or the call, or the call has ended. */
const outageStillAccepted = (err: unknown) =>
  err instanceof ApiError && ![401, 403, 404].includes(err.status) && err.code !== "CALL_NOT_LIVE";
const isReply = (r: unknown): r is TurnReply => {
  const pill = (r as { pill?: { level?: unknown } } | null)?.pill;
  return typeof pill?.level === "string" && LEVELS.includes(pill.level);
};

/**
 * Starts a call on `caseId` and runs it until `end()`. `source` may be a factory, because the live
 * source needs the call's id to mint speech-to-text tokens and the id exists only once the call does.
 * Rejects (after ending the server call) if the call cannot be created or the source cannot start.
 * `onStage` hears each stage go down and come back, for a status line; it carries no cause, since
 * the pill and the outage record already say why.
 */
export async function runCall(opts: {
  caseId: string;
  source: TurnSource | ((callId: string) => TurnSource);
  onView: (v: PillView) => void;
  onStage?: (stage: Stage, up: boolean) => void;
  /** A line for the live trace. It never includes what anyone said. */
  onBeat?: (beat: AgentBeat) => void;
  /** Enum-only state-machine update per finished turn. */
  onDecision?: (reply: TurnReply) => void;
  /** Per-turn HTTP deadline (defaults to TURN_DEADLINE_MS). */
  turnDeadlineMs?: number;
}): Promise<{ callId: string; end(): Promise<void> }> {
  const deadlineMs = opts.turnDeadlineMs ?? TURN_DEADLINE_MS;
  const { call } = await api<{ call: { id: string } }>("/api/calls", { body: { caseId: opts.caseId } });
  const base = `/api/calls/${encodeURIComponent(call.id)}`;
  const source = typeof opts.source === "function" ? opts.source(call.id) : opts.source;

  let state = INITIAL_CLIENT;
  let acceptingTurns = true; // false once the end has flushed the source
  let halted = false; // no more requests: the call ended or was stopped
  let endedOnServer = false;
  const outages = new Map<Stage, OpenOutage>();
  const pending = new Set<Promise<unknown>>();
  const queue: TurnBody[] = [];
  let pumping = false;
  let nextSeq = 1;
  let originMs = Date.now();
  // The pill's clock. A tick before "started" changes nothing, so it can run from here.
  const timer = setInterval(() => dispatch({ type: "tick", nowMs: Date.now() }), TICK_MS);

  const dispatch = (event: ClientEvent) => {
    const before = state.shown;
    state = reduceClient(state, event);
    const now = Date.now();
    if (state.shown.level === "broken") {
      for (const o of outages.values()) if (now - o.startedAtMs > BROKEN_AFTER_MS) o.shownToBanker = true;
    }
    if (state.shown.level !== before.level || state.shown.text !== before.text) opts.onView(state.shown);
    if (endedOnServer && state.shown.level === "idle") clearInterval(timer);
  };

  const track = <T>(p: Promise<T>): Promise<T> => {
    pending.add(p);
    void p.finally(() => pending.delete(p)).catch(() => undefined);
    return p;
  };

  /**
   * Stops listening and leaves the pill on "Blink can't hear the call", because a request was
   * refused in a way no retry fixes (a 401, or the call is no longer this banker's or live). The
   * reading stage is held down from more than BROKEN_AFTER_MS ago, so the pill turns broken now
   * and stays so until `end()`.
   */
  const stopBroken = (why: string, err: unknown) => {
    if (halted) return;
    halted = true;
    acceptingTurns = false;
    source.stop();
    const now = Date.now();
    state = reduceClient(state, { type: "stage_up", stage: "reading" });
    state = reduceClient(state, { type: "stage_down", stage: "reading", atMs: now - BROKEN_AFTER_MS - 1 });
    dispatch({ type: "tick", nowMs: now });
    opts.onStage?.("reading", false);
    console.error(`Blink stopped this call: ${why}.`);
    // Reading is down from here to the end. Record it now if the server will still take it; a reading
    // outage already open is folded in, so the end does not post a second one.
    const earlier = outages.get("reading");
    outages.delete("reading");
    const outage = { startedAtMs: earlier?.startedAtMs ?? now, cause: earlier ? `${earlier.cause}; then ${why}` : why, shownToBanker: true };
    if (outageStillAccepted(err)) void postOutage("reading", outage, null);
  };

  /** A small request that matters for the record: a few tries, then said out loud. */
  const postRecord = (what: string, path: string, body: unknown) =>
    track(
      (async () => {
        const idempotencyKey = crypto.randomUUID(); // one record, however many tries
        let wait = RECONNECT_FIRST_MS;
        for (let attempt = 1; ; attempt++) {
          try {
            await api(path, { body, idempotencyKey });
            return;
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) return stopBroken(`the server refused the ${what}: ${describe(err)}`, err);
            if (!retryable(err) || attempt >= 4) return void console.error(`Blink could not record the ${what}: ${describe(err)}.`);
            await sleep(wait);
            wait = Math.min(wait * 2, RECONNECT_MAX_MS);
          }
        }
      })(),
    );

  const postOutage = (stage: Stage, o: OpenOutage, endedAtMs: number | null) =>
    postRecord(`${stage} outage`, `${base}/outages`, { stage, startedAt: iso(o.startedAtMs), endedAt: endedAtMs === null ? null : iso(endedAtMs), cause: o.cause, shownToBanker: o.shownToBanker });

  const beat = (text: string, tone: AgentBeat["tone"]) => opts.onBeat?.({ text, tone });

  const onStage = (stage: Stage, up: boolean, cause?: string) => {
    if (halted) return;
    const now = Date.now();
    const audible = stage === "hearing" || stage === "transcribing";
    if (!up) {
      if (outages.has(stage)) return;
      if (audible) beat("The call cannot be heard.", "warn");
      outages.set(stage, { startedAtMs: now, cause: cause ?? `${stage} stopped`, shownToBanker: false });
      dispatch({ type: "stage_down", stage, atMs: now });
      opts.onStage?.(stage, false);
      return;
    }
    const open = outages.get(stage);
    if (!open) return;
    if (audible) beat("Hearing the call again.", "quiet");
    dispatch({ type: "tick", nowMs: now }); // settles shownToBanker up to this moment
    outages.delete(stage);
    dispatch({ type: "stage_up", stage });
    opts.onStage?.(stage, true);
    void postOutage(stage, open, now);
  };

  /** A failure that is over as soon as it happens: closes any open outage of `stage`, then records this one on its own. */
  const recordMoment = (stage: Stage, cause: string) => {
    onStage(stage, true);
    if (halted) return;
    const now = Date.now();
    void postOutage(stage, { startedAtMs: now, cause, shownToBanker: false }, now);
  };

  /** Sends one turn until the server has it. The same seq and words every time, so a retry cannot count twice. */
  const sendTurn = async (body: TurnBody) => {
    const idempotencyKey = crypto.randomUUID(); // the same key on every retry of this turn
    let wait = RECONNECT_FIRST_MS;
    beat("Reading this turn.", "work");
    while (!halted) {
      const abort = new AbortController();
      let timedOut = false;
      const deadline = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, deadlineMs);
      let cause: string;
      try {
        const reply = await api<TurnReply>(`${base}/turns`, { body, signal: abort.signal, idempotencyKey });
        clearTimeout(deadline);
        if (!timedOut && !isReply(reply)) {
          // The server took the turn (2xx) but its answer is unusable, and asking again returns the
          // same answer. Show nothing for this turn, record why, and go on to the next.
          recordMoment("reading", `the server's reply to turn ${body.seq} could not be read`);
          return;
        }
        if (!timedOut) {
          const receivedAtMs = Date.now();
          onStage("reading", true);
          dispatch({ type: "decision", level: reply.pill.level, atMs: receivedAtMs });
          opts.onDecision?.(reply);
          const failed = reply.note?.startsWith("The reader stopped") || reply.note?.startsWith("The read ran out of time");
          beat(reply.note ?? "Checked against the policy. No rule applies.", reply.pill.level === "red" ? "stop" : reply.pill.level === "amber" || failed ? "warn" : "quiet");
          const shownAtMs = Date.now();
          void postRecord(`acknowledgement of turn ${body.seq}`, `${base}/acks`, { seq: body.seq, responseReceivedAt: iso(receivedAtMs), shownAt: iso(shownAtMs) });
          return;
        }
        cause = `turn ${body.seq} took more than ${deadlineMs / 1000} s`;
      } catch (err) {
        clearTimeout(deadline);
        if (!timedOut && !retryable(err)) return stopBroken(`turn ${body.seq} was refused: ${describe(err)}`, err);
        cause = timedOut ? `turn ${body.seq} took more than ${deadlineMs / 1000} s` : `turn ${body.seq}: ${describe(err)}`;
      }
      onStage("reading", false, cause);
      await sleep(wait);
      wait = Math.min(wait * 2, RECONNECT_MAX_MS);
    }
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      while (queue.length > 0 && !halted) {
        await sendTurn(queue[0]);
        queue.shift();
      }
    } finally {
      pumping = false;
    }
  };

  const onTurn = (t: FinishedTurn) => {
    if (!acceptingTurns) {
      if (!halted) console.warn("Blink received a turn after the call ended; it was not sent.");
      return;
    }
    queue.push({
      seq: nextSeq++,
      speaker: t.speaker,
      text: t.text,
      speechStartMs: clockMs(t.speechStartMs),
      speechEndMs: clockMs(t.speechEndMs),
      speechEndedAt: iso(originMs + t.speechEndMs),
      transcribedAt: iso(t.transcribedAtMs),
    });
    void pump();
  };

  dispatch({ type: "started" });
  beat("Listening.", "quiet");
  originMs = Date.now();
  try {
    await source.start(onTurn, onStage);
  } catch (err) {
    halted = true;
    acceptingTurns = false;
    source.stop();
    clearInterval(timer);
    await api(`${base}/end`, { body: {} }).catch(() => console.error("Blink could not end a call that failed to start."));
    state = INITIAL_CLIENT;
    opts.onView(INITIAL_CLIENT.shown);
    throw err;
  }

  let shutdown: Promise<void> | null = null;
  let ending: Promise<void> | null = null;

  const finishTurnsAndOutages = async () => {
    source.stop();
    await sleep(END_FLUSH_MS);
    acceptingTurns = false;
    const until = Date.now() + END_DRAIN_MS;
    while ((queue.length > 0 || pumping) && !halted && Date.now() < until) await sleep(50);
    if (queue.length > 0) console.error(`Blink could not send ${queue.length} turn(s) before the call ended.`);
    halted = true; // stops any retry still waiting
    // An outage still open lasts until the end; the server closes it there.
    for (const [stage, o] of outages) void postOutage(stage, o, null);
    outages.clear();
    while (pending.size > 0) await Promise.allSettled([...pending]);
  };

  return {
    callId: call.id,
    end() {
      ending ??= (async () => {
        shutdown ??= finishTurnsAndOutages();
        await shutdown;
        const res = await api<{ hiddenCount: number }>(`${base}/end`, { body: {} });
        endedOnServer = true;
        dispatch({ type: "ended", hiddenCount: res.hiddenCount, atMs: Date.now() });
      })().catch((err: unknown) => {
        ending = null; // let the caller try again; the shutdown is not repeated
        throw err;
      });
      return ending;
    },
  };
}
