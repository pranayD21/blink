/**
 * A call whose turns are fixed: they arrive one every `paceMs`, as if each speaker had just
 * finished. Tests and the browser test drive a whole call with it and no microphone: the turns
 * never change, so the reader's requests replay from recordings like every other stage.
 */
import type { Channel } from "@/core/live/turns";
import type { TurnSource } from "./session";

export interface ScriptTurn {
  speaker: Channel;
  text: string;
}

/**
 * Plays `turns` in order. A turn's speech starts where the previous one ended and ends when it is
 * handed over, timed from the moment `start()` was called, as every TurnSource is. `done` resolves
 * once the last turn is out, or at `stop()`.
 */
export function scriptTurnSource(turns: readonly ScriptTurn[], paceMs: number): TurnSource & { done: Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    finish();
  };

  return {
    done,
    async start(onTurn) {
      const originMs = Date.now();
      let next = 0;
      let lastEndMs = 0;
      const play = () => {
        const turn = turns[next++];
        const endMs = Date.now() - originMs;
        onTurn({ speaker: turn.speaker, text: turn.text, speechStartMs: lastEndMs, speechEndMs: endMs, transcribedAtMs: Date.now() });
        lastEndMs = endMs;
        if (next < turns.length) timer = setTimeout(play, paceMs);
        else stop();
      };
      if (stopped || turns.length === 0) return stop();
      timer = setTimeout(play, paceMs);
    },
    stop,
  };
}
