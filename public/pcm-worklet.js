/**
 * Turns one audio channel into 80 ms frames of 16-bit PCM for Deepgram Flux. The AudioContext runs
 * at 16,000 Hz, so a frame is 1,280 samples. Each message is `{ pcm: ArrayBuffer, peak: number }`,
 * where `peak` is the frame's largest absolute sample (0 to 1), and is exactly 0 only for digital
 * silence, which is how a dead system-audio track shows itself.
 */
const FRAME_SAMPLES = 1280;

class PcmFrames extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    this.peak = 0;
  }

  process(inputs) {
    const input = inputs[0];
    // No input connected yet (or the track went away): nothing to send, but keep the node alive.
    if (!input || input.length === 0) return true;
    const length = input[0].length;
    for (let i = 0; i < length; i++) {
      // Mix a stereo source (system audio usually is) down to mono.
      let mixed = 0;
      for (let c = 0; c < input.length; c++) mixed += input[c][i];
      const s = Math.max(-1, Math.min(1, mixed / input.length));
      const abs = Math.abs(s);
      if (abs > this.peak) this.peak = abs;
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === FRAME_SAMPLES) {
        const pcm = this.frame.buffer;
        this.port.postMessage({ pcm, peak: this.peak }, [pcm]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.filled = 0;
        this.peak = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-frames", PcmFrames);
