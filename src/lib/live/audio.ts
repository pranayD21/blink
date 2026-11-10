/**
 * Browser audio for a live call: the banker's microphone and the computer's own audio (everyone
 * else on the call) as two separate streams, and a way to turn one stream into 80 ms PCM frames.
 */

export interface AudioChannels {
  analyst: MediaStream;
  expert: MediaStream;
  stop(): void;
}

export const SAMPLE_RATE = 16000;
export const FRAME_SAMPLES = 1280;
export const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

const stopAll = (...streams: MediaStream[]) => streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));

/**
 * The microphone, and system audio through getDisplayMedia. Video is asked for as well because the
 * Mac spike has not yet shown that audio alone is granted (notes, Task 3); its track is disabled
 * but kept, since ending it can end the capture. Throws if either channel cannot be had.
 */
export async function captureChannels(): Promise<AudioChannels> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    stopAll(mic);
    throw err;
  }
  const systemTracks = display.getAudioTracks();
  if (systemTracks.length === 0) {
    stopAll(mic, display);
    throw new Error("The computer's audio was not shared, so Blink cannot hear the other side of the call.");
  }
  display.getVideoTracks().forEach((t) => (t.enabled = false));
  return {
    analyst: mic,
    expert: new MediaStream(systemTracks),
    stop: () => stopAll(mic, display),
  };
}

export interface PcmFrame {
  pcm: ArrayBuffer;
  peak: number;
  atMs: number;
}

/**
 * Runs `stream` through `public/pcm-worklet.js` in its own 16 kHz AudioContext and calls `onFrame`
 * for every 1,280-sample frame. The output goes to a muted gain, only so the graph is pulled.
 */
export async function pcmFrames(stream: MediaStream, onFrame: (f: PcmFrame) => void): Promise<{ stop(): void }> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "pcm-frames", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; peak: number }>) => onFrame({ pcm: e.data.pcm, peak: e.data.peak, atMs: Date.now() });
    source.connect(node).connect(mute).connect(ctx.destination);
    if (ctx.state === "suspended") await ctx.resume();
    return {
      stop: () => {
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        void ctx.close();
      },
    };
  } catch (err) {
    void ctx.close();
    throw err;
  }
}
