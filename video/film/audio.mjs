// An original score and sound design, on the film's own timeline. Writes music.wav (ducked) and vo.wav.
import { readFileSync, writeFileSync } from "node:fs";
const T = JSON.parse(readFileSync("src/timeline.json", "utf8")), NARR = JSON.parse(readFileSync("src/narration.json", "utf8"));
const K = T.cues, A = T.at, B = T.B, SR = 48000, N = Math.ceil((T.total + 0.1) * SR);
const mk = () => [new Float32Array(N), new Float32Array(N)];
const pad = mk(), arp = mk(), low = mk(), sfx = mk(), send = mk();
let seed = 12345; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12), TAU = Math.PI * 2;
function tone(bus, t0, dur, f, amp, o = {}) {
  const { a = 0.01, rel = 0.1, harm = [1], pan = 0, exp = 0, wet = 0, vib = 0, det = 0 } = o;
  const s0 = Math.max(0, Math.floor(t0 * SR)), s1 = Math.min(N, Math.floor((t0 + dur + rel) * SR)), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let s = s0; s < s1; s++) { const t = s / SR - t0; let e = Math.min(1, t / a); if (t > dur) e *= Math.max(0, 1 - (t - dur) / rel); if (exp) e *= Math.exp(-t * exp); let v = 0; const ff = f * (1 + vib * Math.sin(TAU * 4.3 * t)); for (let h = 0; h < harm.length; h++) if (harm[h]) { v += harm[h] * Math.sin(TAU * ff * (h + 1) * t); if (det) v += harm[h] * 0.7 * Math.sin(TAU * ff * (1 + det) * (h + 1) * t + 1.3); } v *= amp * e; bus[0][s] += v * gl; bus[1][s] += v * gr; if (wet) { send[0][s] += v * gl * wet; send[1][s] += v * gr * wet; } }
}
function noise(bus, t0, dur, amp, o = {}) { // filtered noise with a sweeping cutoff
  const { f0 = 800, f1 = 800, shape = "hann", pan = 0, wet = 0.2, hp = 0 } = o; const s0 = Math.max(0, Math.floor(t0 * SR)), n = Math.floor(dur * SR); let y = 0, y2 = 0;
  for (let i = 0; i < n && s0 + i < N; i++) { const p = i / n, f = f0 * (f1 / f0) ** p, c = 1 - Math.exp(-TAU * f / SR); y += c * (rand() - y); y2 += 0.01 * (y - y2); let e = shape === "hann" ? Math.sin(Math.PI * p) ** 2 : shape === "rise" ? p ** 2 * (p > 0.92 ? (1 - p) / 0.08 : 1) : Math.exp(-p * 7) * Math.min(1, i / 60); const v = (hp ? y - y2 : y) * amp * e; bus[0][s0 + i] += v * (1 - pan * 0.5); bus[1][s0 + i] += v * (1 + pan * 0.5); send[0][s0 + i] += v * wet; send[1][s0 + i] += v * wet; }
}
const thump = (t, amp = 0.6, f = 58) => { const s0 = Math.floor(t * SR), n = Math.floor(0.55 * SR); for (let i = 0; i < n && s0 + i < N; i++) { const x = i / SR, ph = TAU * (f * x + 26 * (1 - Math.exp(-x * 30)) / 30 * 1.6), v = Math.sin(ph) * Math.exp(-x * 7.5) * amp * Math.min(1, i / 40); sfx[0][s0 + i] += v; sfx[1][s0 + i] += v; } };
const tick = (t, amp = 0.05, f = 3200) => { noise(sfx, t, 0.03, amp, { f0: f, f1: f, shape: "hit", wet: 0.15, hp: 1 }); };
const bell = (t, m, amp, pan = 0, ring = 2.2) => tone(sfx, t, 0.02, hz(m), amp, { a: 0.003, rel: ring, harm: [1, 0.25, 0, 0.3, 0, 0.12], exp: 1.5, pan, wet: 0.55 });

// ---- Score ----
const bpm = 92, beat = 60 / bpm, bar = beat * 4;
const CH = [[45, 57, 60, 64, 71], [41, 57, 60, 64, 67], [48, 55, 64, 67, 72], [43, 55, 62, 67, 69]]; // Am9, Fmaj7, C, G6
// Tension: drone and a heartbeat under the hook.
tone(pad, 0, B.b1 + 0.3, hz(33), 0.1, { a: 2.5, rel: 0.6, harm: [1, 0.5, 0.2], det: 0.003, wet: 0.3 });
tone(pad, 1.5, B.b1 - 1.2, hz(40), 0.07, { a: 3, rel: 0.6, harm: [1, 0.4], det: 0.004, wet: 0.4 });
tone(pad, K.redWords, B.b1 - K.redWords, hz(81), 0.018, { a: 1.6, rel: 0.6, harm: [1, 0, 0.3], vib: 0.003, wet: 0.8 });
tone(pad, K.redWords, B.b1 - K.redWords, hz(82), 0.014, { a: 2, rel: 0.6, harm: [1], vib: 0.004, wet: 0.8, pan: 0.5 });
for (let t = 3.9; t < B.b1 - 0.2; t += 1.0) { thump(t, 0.13 + 0.09 * (t / B.b1), 50); thump(t + 0.26, 0.07 + 0.06 * (t / B.b1), 46); }
// Warm body: pads, arpeggio, later a pulse and bass.
function section(t0, t1, o) { for (let t = t0, c = o.c ?? 0; t < t1; t += bar * 2, c++) { const ch = CH[c % 4], d = Math.min(bar * 2, t1 - t);
  ch.forEach((m, i) => tone(pad, t, d, hz(m), (i === 0 ? 0.075 : 0.042) * (o.padAmp ?? 1), { a: 0.9, rel: 1.1, harm: [1, 0.38, 0.14, 0.05], det: 0.0028, pan: (i - 2) * 0.28, wet: 0.45 }));
  if (o.arp) { const pat = [3, 4, 2, 4, 3, 1, 2, 4, 3, 4, 2, 3, 4, 2, 1, 3]; for (let k = 0; k < 16; k++) { const at = t + k * beat / 2; if (at >= t1) break; const m = ch[pat[k] % 5] + 12; tone(arp, at, 0.03, hz(m), 0.05 * o.arp * (k % 4 === 0 ? 1.25 : 0.8), { a: 0.004, rel: 0.75, harm: [1, 0.3, 0.1], exp: 5, pan: Math.sin(k * 1.7) * 0.45, wet: 0.6 }); } }
  if (o.bass) for (let k = 0; k < 8; k++) { const at = t + k * beat; if (at >= t1) break; if (k % 2 === 0) tone(low, at, beat * 0.8, hz(ch[0] - (ch[0] > 44 ? 12 : 0)), 0.12 * o.bass, { a: 0.01, rel: 0.1, harm: [1, 0.3], exp: 1.5 }); }
  if (o.kick) for (let k = 0; k < 8; k++) { const at = t + k * beat; if (at >= t1) break; thump(at, 0.24 * o.kick, 52); noise(arp, at + beat / 2, 0.05, 0.03 * o.kick, { f0: 8000, f1: 9000, shape: "hit", wet: 0.1, hp: 1 }); }
} }
section(B.b1 + 0.45, T.pillRed - 0.05, { arp: 0.7, padAmp: 0.95 });
section(T.pillRed + 2.7, B.b2 + 0.3, { c: 1, arp: 0.8 });
section(B.b2 + 0.42, B.b3 + 0.3, { c: 0, arp: 1, bass: 0.6, kick: 0.42, padAmp: 0.95 });
section(B.b3 + 0.42, B.b4 + 0.3, { c: 2, arp: 1, bass: 0.55, kick: 0.3, padAmp: 0.9 });
// Resolve: Cmaj9, held under the end.
[36, 48, 55, 64, 71, 74].forEach((m, i) => tone(pad, B.b4 + 0.42, T.total - B.b4 - 1.6, hz(m), i < 2 ? 0.075 : 0.04, { a: 1.2, rel: 1.1, harm: [1, 0.35, 0.12], det: 0.0026, pan: (i - 2.5) * 0.22, wet: 0.55 }));

// ---- Sound design ----
for (let i = 0; i < 44; i++) { const t = 0.9 + i * (2 / 44) + rand() * 0.012; tick(t, 0.05 + 0.02 * Math.abs(rand()), 2600 + Math.abs(rand()) * 1800); }
thump(K.redWords - 0.02, 0.5, 44); tone(sfx, K.redWords, 0.02, hz(40), 0.14, { a: 0.003, rel: 1.8, harm: [1, 0.7, 0.45, 0.3], exp: 1.5, wet: 0.5 });
thump(K.inside, 0.3, 62); noise(sfx, K.inside, 0.09, 0.2, { f0: 2400, f1: 900, shape: "hit", wet: 0.35 });
noise(sfx, K.wall - 0.1, 2.5, 0.05, { f0: 300, f1: 1300, shape: "hann", wet: 0.5 });
const lid = (b) => { noise(sfx, b - 0.02, 0.4, 0.2, { f0: 500, f1: 3600, shape: "rise", wet: 0.3 }); thump(b + 0.4, 0.62, 48); noise(sfx, b + 0.44, 0.46, 0.09, { f0: 2400, f1: 400, shape: "hann", wet: 0.45 }); };
[B.b1, B.b2, B.b3, B.b4].forEach(lid);
bell(A.l4 - 0.3, 76, 0.1, -0.2); bell(A.l4 + 0.05, 83, 0.07, 0.25);
for (let i = 0; i < 12; i++) tick(K.everyTurn + i / 3.2, 0.05, 4200);
[K.noTranscript - 0.45, K.noSugg - 0.2, K.noNoise - 0.15].forEach((t) => { thump(t, 0.3, 70); tick(t, 0.11, 1800); });
noise(sfx, K.onlyThis - 0.05, 1.3, 0.035, { f0: 600, f1: 2400, shape: "hann", wet: 0.5 });
// The pill: everything drops out, one clean alert.
thump(T.pillRed, 0.9, 42); bell(T.pillRed, 88, 0.2, 0, 2.6); bell(T.pillRed + 0.14, 95, 0.13, 0, 2.2);
noise(sfx, K.reads8 - 0.1, K.hides - K.reads8, 0.04, { f0: 900, f1: 5200, shape: "rise", wet: 0.4 });
for (let i = 0; i < 4; i++) { const t = K.hides + 0.1 + i * 0.3; noise(sfx, t, 0.36, 0.13, { f0: 3400, f1: 1000, shape: "hann", pan: i % 2 ? 0.4 : -0.4, wet: 0.3 }); thump(t + 0.33, 0.18, 88); }
bell(K.sends, 79, 0.1, 0.1, 1.6); bell(K.sends + 0.12, 84, 0.07, -0.1, 1.6);
[K.quotes - 0.3, K.rule - 0.15, K.written - 0.1, K.compiled - 0.15, K.tested - 0.15, K.approved - 0.15, K.drafted - 0.1, K.every12 - 0.1, K.cited + 0.3, K.blank - 0.15, K.tamper - 0.1, K.measured - 0.15, K.misses - 0.15].forEach((t, i) => noise(sfx, t, 0.5, 0.05, { f0: 500, f1: 2100, shape: "hann", pan: i % 2 ? 0.45 : -0.45, wet: 0.4 }));
[A.l10a, A.l10b, A.l10c].forEach((t, i) => { thump(t - 0.04, 0.22, 58); bell(t, [76, 79, 84][i], 0.06, 0, 1.3); });
bell(K.approved + 0.75, 84, 0.07, 0.1, 1.2); bell(K.cited + 0.75, 84, 0.07, -0.1, 1.2); bell(K.tamper + 0.55, 79, 0.06, 0.1, 1.2);
thump(T.logo2 - 0.05, 0.4, 44); bell(A.l16 + 0.62, 72, 0.13, -0.15, 3.4); bell(A.l16 + 0.77, 79, 0.1, 0.15, 3.4); bell(A.l16 + 0.92, 88, 0.07, 0, 3.4);

// ---- Reverb on the send ----
function reverb(x, offs) { const y = new Float32Array(N); for (const [d0, g] of [[1557, .86], [1617, .85], [1491, .87], [1422, .88], [1277, .86], [1356, .87]]) { const d = Math.floor((d0 + offs) * 2.4), buf = new Float32Array(d); let i = 0, lp = 0; for (let s = 0; s < N; s++) { const o = buf[i]; lp = o * 0.62 + lp * 0.38; buf[i] = x[s] + lp * g; i = (i + 1) % d; y[s] += o * 0.14; } } for (const [d0, g] of [[225, .5], [556, .5]]) { const d = d0 + offs, buf = new Float32Array(d); let i = 0; for (let s = 0; s < N; s++) { const b = buf[i], v = y[s]; const o = -v + b; buf[i] = v + b * g; i = (i + 1) % d; y[s] = o; } } return y; }
const wet = [reverb(send[0], 0), reverb(send[1], 23)];

// ---- Voice bus and the ducking it drives ----
const vo = new Float32Array(N); const dur = {};
for (const l of NARR) { const b = readFileSync(`public/audio/${l.id}.wav`); let p = 12; while (b.toString("latin1", p, p + 4) !== "data") p += 8 + b.readUInt32LE(p + 4); const len = b.readUInt32LE(p + 4), o = Math.floor(A[l.id] * SR); for (let i = 0; i < len / 2 && o + i < N; i++) vo[o + i] = b.readInt16LE(p + 8 + i * 2) / 32768; }
const talk = new Float32Array(N); for (const l of NARR) { const a = Math.floor((A[l.id] - 0.08) * SR), e = Math.floor((A[l.id] + l.dur + 0.06) * SR); talk.fill(1, Math.max(0, a), Math.min(N, e)); }
let env = 0; const duck = new Float32Array(N); for (let s = 0; s < N; s++) { env += (talk[s] - env) * (talk[s] > env ? 1 / (0.05 * SR) : 1 / (0.38 * SR)); duck[s] = 1 - 0.74 * env; }
// Music falls away for the pill, and fades out at the end.
const gate = (t) => { let g = 1; const p = T.pillRed; if (t > p - 0.06 && t < p + 2.9) g = t < p ? Math.max(0.06, (p - t) / 0.06) : t > p + 2.2 ? 0.06 + 0.94 * (t - p - 2.2) / 0.7 : 0.06; const end = T.total; if (t > end - 2.2) g *= Math.max(0, (end - t) / 2.2); return g; };
const out = mk(); for (let c = 0; c < 2; c++) for (let s = 0; s < N; s++) { const t = s / SR, m = (pad[c][s] + arp[c][s] + low[c][s]) * duck[s] * gate(t), fx = sfx[c][s] * (1 - 0.5 * (1 - (duck[s] - 0.26) / 0.74)) * (t > T.total - 1.6 ? Math.max(0, (T.total - t) / 1.6) : 1), w = wet[c][s] * (0.55 + 0.45 * duck[s]) * (t > T.total - 1.6 ? Math.max(0, (T.total - t) / 1.6) : 1); out[c][s] = m * 0.95 + fx * 0.72 + w * 0.5; }
function wav(chs, path) { const n = chs[0].length, C = chs.length, b = Buffer.alloc(44 + n * C * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * C * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(C, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * C * 2, 28); b.writeUInt16LE(C * 2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * C * 2, 40); for (let s = 0; s < n; s++) for (let c = 0; c < C; c++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.tanh(chs[c][s] * 0.9) * 32767)), 44 + (s * C + c) * 2); writeFileSync(path, b); }
wav(out, "music.wav"); wav([vo], "vo.wav"); console.log("audio written", (N / SR).toFixed(1), "s");
