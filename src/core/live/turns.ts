/**
 * Turns the two Flux streams of a live call (microphone = banker, system audio = expert) into
 * finished turns, and watches the two channels' levels for a dead system-audio track. Pure: time
 * arrives with every input.
 */
import { isEchoOf } from "./echo";
import type { FluxEvent } from "./flux";

export type Channel = "analyst" | "expert";

/** One parsed Flux message. `atMs` is the wall clock when the message arrived. */
export interface ChannelEvent {
  channel: Channel;
  event: FluxEvent;
  atMs: number;
}

/**
 * A turn ready to send. `speechStartMs`/`speechEndMs` are on the clock of the events pushed in
 * (the source's call clock); `transcribedAtMs` is the wall clock when its end of turn arrived.
 */
export interface FinishedTurn {
  speaker: Channel;
  text: string;
  speechStartMs: number;
  speechEndMs: number;
  transcribedAtMs: number;
}

export interface TurnAssembler {
  push(e: ChannelEvent): FinishedTurn[];
}

/** A microphone turn this soon after a far-side turn ended is checked for being that turn's echo. */
export const ECHO_WINDOW_MS = 4000;

export function createTurnAssembler(): TurnAssembler {
  let recentExpert: { text: string; atMs: number }[] = [];

  return {
    push({ channel, event, atMs }) {
      if (event.kind !== "end") return [];
      const text = event.transcript.trim();
      if (!text) return [];

      recentExpert = recentExpert.filter((t) => atMs - t.atMs <= ECHO_WINDOW_MS);
      if (channel === "expert") {
        recentExpert.push({ text, atMs });
      } else if (recentExpert.length > 0 && isEchoOf(text, recentExpert.map((t) => t.text).join(" "))) {
        // The banker's microphone heard the far side through the speakers.
        return [];
      }
      return [{ speaker: channel, text, speechStartMs: event.audioStartMs, speechEndMs: event.audioEndMs, transcribedAtMs: atMs }];
    },
  };
}

/** One audio frame's peak level, 0 to 1 of full scale. */
export interface LevelSample {
  channel: Channel;
  peak: number;
  atMs: number;
}

export interface HearingWatch {
  /** "down" or "up" when the system-audio channel's health changes with this frame, else null. */
  push(s: LevelSample): "down" | "up" | null;
}

/** How long the system-audio channel must be exact digital silence before hearing is down. */
export const DEAD_SYSTEM_AUDIO_MS = 3000;
/** A microphone frame at or above this peak counts as the banker speaking (about -34 dBFS). */
export const MIC_SPEECH_PEAK = 0.02;

/**
 * Hearing is down when the system-audio channel has delivered exact zeros for DEAD_SYSTEM_AUDIO_MS
 * and the microphone heard speech in that span: a live call always carries some signal, while a
 * track macOS refused to fill is perfect silence. It is up again on the first frame that is not.
 */
export function createHearingWatch(): HearingWatch {
  let zeroSinceMs: number | null = null;
  let micSpeechAtMs: number | null = null;
  let down = false;

  return {
    push({ channel, peak, atMs }) {
      if (channel === "analyst") {
        if (peak >= MIC_SPEECH_PEAK) micSpeechAtMs = atMs;
      } else if (peak > 0) {
        zeroSinceMs = null;
        if (down) {
          down = false;
          return "up";
        }
        return null;
      } else if (zeroSinceMs === null) {
        zeroSinceMs = atMs;
      }

      if (!down && zeroSinceMs !== null && atMs - zeroSinceMs >= DEAD_SYSTEM_AUDIO_MS && micSpeechAtMs !== null && micSpeechAtMs >= zeroSinceMs) {
        down = true;
        return "down";
      }
      return null;
    },
  };
}
