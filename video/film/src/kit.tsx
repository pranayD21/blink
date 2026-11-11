import React, { useLayoutEffect, useRef } from "react";
import { Easing, Img, interpolate, staticFile } from "remotion";
import { loadFont } from "@remotion/google-fonts/InstrumentSans";
export const { fontFamily } = loadFont("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
export const C = { bg: "#070706", fg: "#f6f1e8", mut: "#b7b0a4", dim: "#6d675d", red: "#ef4444", amber: "#f5a524", green: "#2fb37a", card: "#12110f" };
export const io = Easing.bezier(0.65, 0, 0.35, 1), out = Easing.bezier(0.16, 1, 0.3, 1), inn = Easing.bezier(0.7, 0, 0.84, 0);
export const r = (t: number, a: number, b: number, x = 0, y = 1, e = out) => interpolate(t, [a, b], [x, y], { easing: e, extrapolateLeft: "clamp", extrapolateRight: "clamp" });
export const rnd = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

export const Bg: React.FC<{ t: number; warm?: number }> = ({ t, warm = 1 }) => (
  <div style={{ position: "absolute", inset: 0, background: C.bg, overflow: "hidden" }}>
    <div style={{ position: "absolute", inset: "-25%", opacity: 0.55 * warm, transform: `translate3d(${Math.sin(t / 9) * 90}px,${Math.cos(t / 11) * 30}px,0)`,
      background: "repeating-linear-gradient(100deg,transparent 0%,rgba(255,255,255,.10) 7%,transparent 14%,transparent 22%,rgba(255,226,190,.08) 30%,transparent 40%),radial-gradient(ellipse 50% 45% at 18% 12%,rgba(255,244,225,.13),transparent 62%),radial-gradient(ellipse 45% 55% at 85% 85%,rgba(255,226,190,.08),transparent 60%)" }} />
    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 85% 85% at 50% 50%,transparent 45%,rgba(0,0,0,.72))" }} />
  </div>
);
export const Grain: React.FC<{ f: number }> = ({ f }) => { const k = Math.floor(f / 2); return <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: 0.075, mixBlendMode: "overlay", backgroundImage: `url(${staticFile("grain.png")})`, backgroundPosition: `${Math.floor(rnd(k) * 512)}px ${Math.floor(rnd(k + 9) * 512)}px` }} />; };

/** The edit itself: an eyelid closes over the frame and opens on the next chapter. */
export const Lid: React.FC<{ t: number; at: number }> = ({ t, at }) => {
  const d = t - at; if (d < 0 || d > 0.9) return null;
  const open = d < 0.36 ? r(d, 0, 0.36, 1, 0, inn) : d < 0.46 ? 0 : r(d, 0.46, 0.9, 0, 1, out);
  const h = open * 1500, y = 540;
  return <svg viewBox="0 0 1920 1080" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}><path fillRule="evenodd" fill="#000" d={`M-200,-200H2120V1280H-200Z M-200,${y} Q960,${y - h} 2120,${y} Q960,${y + h} -200,${y} Z`} /></svg>;
};

const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
export const Dither: React.FC<{ t: number; opacity?: number }> = ({ t, opacity = 1 }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current!, x = c.getContext("2d", { alpha: false })!; const w = c.width, h = c.height, im = x.createImageData(w, h), d = im.data, T = t * 0.75;
    for (let j = 0; j < h; j++) { const ny = j / h, row = BAYER[j % 4]; for (let i = 0; i < w; i++) { const nx = i / w; const tone = (Math.sin(nx * 6 + T) * Math.cos(ny * 5 - T * 0.8) * 0.55 + Math.sin((nx + ny) * 10 + T * 1.4) * 0.45 + 1) / 2; const v = tone > (row[i % 4] + 0.5) / 16 ? 235 : 8; const k = (j * w + i) * 4; d[k] = v; d[k + 1] = v * 0.975; d[k + 2] = v * 0.93; d[k + 3] = 255; } }
    x.putImageData(im, 0, 0);
  }, [t]);
  return <canvas ref={ref} width={640} height={360} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", imageRendering: "pixelated", opacity }} />;
};

export const Mark: React.FC<{ size?: number; lid?: number }> = ({ size = 92, lid = 0.08 }) => (
  <span style={{ position: "relative", display: "inline-block", width: size, height: size * 0.52, borderRadius: 999, overflow: "hidden", background: C.fg, boxShadow: "inset 0 0 10px rgba(255,255,255,.3)" }}>
    <span style={{ position: "absolute", inset: 0, background: "#141310", transform: `scaleY(${lid})` }} />
  </span>
);

/** Words that arrive one line at a time, on the beat they are spoken. */
export const Line: React.FC<{ t: number; at: number; children: React.ReactNode; size?: number; color?: string; until?: number; weight?: number; style?: React.CSSProperties }> = ({ t, at, children, size = 58, color = C.fg, until, weight = 400, style }) => {
  const a = r(t, at, at + 0.5), o = until ? 1 - r(t, until, until + 0.3) : 1;
  return <div style={{ fontSize: size, lineHeight: 1.14, letterSpacing: "-0.022em", color, fontWeight: weight, opacity: a * o, transform: `translateY(${(1 - a) * 26}px)`, filter: `blur(${(1 - a) * 8}px)`, ...style }}>{children}</div>;
};
export const Eyebrow: React.FC<{ t: number; at: number; children: React.ReactNode }> = ({ t, at, children }) => { const a = r(t, at, at + 0.5); return <div style={{ fontSize: 19, letterSpacing: "0.2em", textTransform: "uppercase", color: C.mut, opacity: a, marginBottom: 26, display: "flex", alignItems: "center", gap: 14 }}><span style={{ width: 40 * a, height: 1, background: C.mut, display: "inline-block" }} />{children}</div>; };

type Rect = number[]; export type Cam = { at: number; dur?: number; rect: Rect | null }; export type Spot = { from: number; to: number; rect: Rect; label?: string; color?: string };
const FULL = [0, 0, 1, 1];
const cam = (t: number, keys: Cam[]) => { let cur = FULL; for (const k of keys) { const tgt = k.rect ?? FULL; const p = r(t, k.at, k.at + (k.dur ?? 1.1), 0, 1, io); cur = cur.map((v, i) => v + (tgt[i] - v) * p); } return cur; };

/** A floating window on the real product, with a camera that moves inside it. */
export const Shot: React.FC<{ t: number; x: number; y: number; w: number; enter: number; exit?: number; shots: { src: string; at: number }[]; cams?: Cam[]; spots?: Spot[] }> = ({ t, x, y, w, enter, exit, shots, cams = [], spots = [] }) => {
  const h = (w * 9) / 16, a = r(t, enter, enter + 0.9), z = exit ? r(t, exit, exit + 0.4, 0, 1, io) : 0;
  const c = cam(t, cams); const drift = 1 + (t - enter) * 0.0035; let s = Math.min(1 / c[2], 1 / c[3]) * drift;
  let cx = c[0] + c[2] / 2, cy = c[1] + c[3] / 2; const hw = 0.5 / s; cx = Math.min(Math.max(cx, hw), 1 - hw); cy = Math.min(Math.max(cy, hw), 1 - hw);
  const tf = `translate(${w / 2 - cx * w * s}px,${h / 2 - cy * h * s}px) scale(${s})`;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, perspective: 2200, opacity: a * (1 - z) }}>
      <div style={{ position: "absolute", inset: 0, borderRadius: 22, overflow: "hidden", background: "#0a0a09", transform: `translateY(${(1 - a) * 70 + z * -24}px) rotateX(${(1 - a) * 9}deg) scale(${0.965 + a * 0.035})`, boxShadow: "0 0 0 1px rgba(255,255,255,.18),0 50px 120px rgba(0,0,0,.65),0 0 160px rgba(255,235,205,.09)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, transformOrigin: "0 0", transform: tf }}>
          {shots.map((sh, i) => { const nx = shots[i + 1]?.at ?? 1e9; if (t < sh.at - 0.05 || t > nx + 0.5) return null; const o = i === 0 ? 1 : r(t, sh.at, sh.at + 0.4, 0, 1, io); return <Img key={sh.src} src={staticFile(`shots/${sh.src}.png`)} style={{ position: "absolute", left: 0, top: 0, width: w, height: h, opacity: o }} />; })}
          {spots.map((p, i) => { const o = r(t, p.from, p.from + 0.4) * (1 - r(t, p.to, p.to + 0.3)); if (o <= 0) return null; const col = p.color ?? C.fg; const pad = 5 / s; return <div key={i} style={{ position: "absolute", left: p.rect[0] * w - pad, top: p.rect[1] * h - pad, width: p.rect[2] * w + pad * 2, height: p.rect[3] * h + pad * 2, borderRadius: 10 / s, opacity: o, boxShadow: `0 0 0 ${1.6 / s}px ${col},0 0 ${26 / s}px ${col}66,0 0 0 4000px rgba(0,0,0,.52)` }} />; })}
        </div>
      </div>
    </div>
  );
};
