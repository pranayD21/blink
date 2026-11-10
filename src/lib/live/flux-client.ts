/**
 * One Deepgram Flux socket per audio channel, fed 80 ms PCM frames, reconnecting on its own.
 *
 * The browser WebSocket cannot set headers, so the short-lived token from /v1/auth/grant goes in
 * the Sec-WebSocket-Protocol header as `bearer, <token>`, as Deepgram documents for client-side
 * connections (checked against the live service: `bearer` opens, `token` with a grant token is 401).
 */
import { isEndWithoutWindow, parseFluxMessage } from "@/core/live/flux";
import { FRAME_MS, pcmFrames } from "./audio";

export const FLUX_URL = "wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.8&eot_timeout_ms=7000";
export const RECONNECT_FIRST_MS = 250;
export const RECONNECT_MAX_MS = 4000;
/** A socket counts as working, and the backoff starts again from RECONNECT_FIRST_MS, once it has stayed open this long or sent a transcript message. */
export const STABLE_AFTER_MS = 5000;
/** After CloseStream, how long to wait for Flux to send its last turn and close before closing ourselves. */
const CLOSE_GRACE_MS = 2000;

export interface FluxOptions {
  /** Mints a fresh token for each reconnect. Without it the first token is reused, which fails once it expires (30 s). */
  mint?: () => Promise<string>;
  /** Every frame's peak level (0 to 1), whether or not the socket is up. */
  onLevel?: (peak: number, atMs: number) => void;
  /**
   * The audio pipeline could not be built, so no socket is opened and nothing will be transcribed
   * on this channel until the call ends. Without it the failure goes to `onState(false, cause)`,
   * which no later event clears either.
   */
  onAudioFailed?: (cause: string) => void;
}

/**
 * `onMessage` gets each text message, the wall clock it arrived, and the wall clock of the start of
 * the audio on the socket that sent it: Flux times its audio windows from there, and every
 * reconnect starts that clock again. `onState(false, cause)` when the socket drops (or a turn is
 * lost), `onState(true)` when it is open again.
 */
export function openFlux(
  token: string,
  stream: MediaStream,
  onMessage: (raw: string, atMs: number, audioStartedAtMs: number) => void,
  onState: (up: boolean, cause?: string) => void,
  opts: FluxOptions = {},
): { close(): void } {
  let closed = false;
  let ws: WebSocket | null = null;
  let audioStartedAtMs: number | null = null;
  let backoffMs = RECONNECT_FIRST_MS;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stable: ReturnType<typeof setTimeout> | null = null;
  let frames: { stop(): void } | null = null;

  const clearStable = () => {
    if (stable) clearTimeout(stable);
    stable = null;
  };
  // Only a socket that has proved itself resets the backoff, so one that opens and drops at once
  // keeps backing off instead of reconnecting every 250 ms.
  const markStable = () => {
    clearStable();
    backoffMs = RECONNECT_FIRST_MS;
  };

  const connect = (tok: string) => {
    const socket = new WebSocket(FLUX_URL, ["bearer", tok]);
    socket.binaryType = "arraybuffer";
    ws = socket;
    audioStartedAtMs = null;
    socket.onopen = () => {
      stable = setTimeout(markStable, STABLE_AFTER_MS);
      onState(true);
    };
    socket.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      const atMs = Date.now();
      // Flux greets every socket with `Connected`; only a transcript message (TurnInfo) shows it is working.
      if (stable && parseFluxMessage(e.data).kind !== "other") markStable();
      if (isEndWithoutWindow(e.data)) {
        // A finished turn Flux sent without its audio times cannot be placed or sent: record it as a
        // momentary transcribing outage rather than let it vanish.
        onState(false, "speech-to-text ended a turn without its audio times; that turn was lost");
        onState(true);
        return;
      }
      onMessage(e.data, atMs, audioStartedAtMs ?? atMs);
    };
    socket.onclose = (e: CloseEvent) => {
      if (ws !== socket) return;
      ws = null;
      clearStable();
      if (closed) return;
      onState(false, `the speech-to-text connection closed (code ${e.code}${e.reason ? `, ${e.reason}` : ""})`);
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    const wait = backoffMs;
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
    retry = setTimeout(async () => {
      retry = null;
      if (closed) return;
      let tok = token;
      if (opts.mint) {
        try {
          tok = await opts.mint();
        } catch {
          // Still down; onState(false) was already reported. Try again after the next wait.
          if (!closed) scheduleReconnect();
          return;
        }
      }
      if (!closed) connect(tok);
    }, wait);
  };

  const onFrame = ({ pcm, peak, atMs }: { pcm: ArrayBuffer; peak: number; atMs: number }) => {
    opts.onLevel?.(peak, atMs);
    // Frames that arrive while the socket is down are dropped; the outage records the gap.
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // The frame's audio began FRAME_MS before the worklet posted it.
    if (audioStartedAtMs === null) audioStartedAtMs = atMs - FRAME_MS;
    ws.send(pcm);
  };

  // The socket opens only once audio is flowing: a socket with no audio behind it would report
  // transcribing as up while nothing can be transcribed.
  pcmFrames(stream, onFrame).then(
    (f) => {
      if (closed) return f.stop();
      frames = f;
      connect(token);
    },
    (err: unknown) => {
      if (closed) return;
      const cause = `the audio could not be prepared for speech-to-text (${err instanceof Error ? err.name : "error"})`;
      if (opts.onAudioFailed) opts.onAudioFailed(cause);
      else onState(false, cause);
    },
  );

  return {
    close() {
      if (closed) return;
      closed = true;
      if (retry) clearTimeout(retry);
      clearStable();
      frames?.stop();
      const socket = ws;
      if (!socket) return;
      if (socket.readyState === WebSocket.OPEN) {
        // Ask Flux to finish: it sends what it still holds, then closes. Messages keep flowing until then.
        socket.send(JSON.stringify({ type: "CloseStream" }));
        setTimeout(() => socket.close(), CLOSE_GRACE_MS);
      } else {
        socket.close();
      }
    },
  };
}
