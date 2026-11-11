"use client";

import { useEffect, useRef } from "react";

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** CSS pixels per dither dot. */
const DOT = 3;
/** The field drifts slowly, so 30 frames a second look the same as 60 at half the work. */
const FRAME_MS = 1000 / 30;

/**
 * A moving black-and-white dither, the backdrop of the landing page.
 *
 * The canvas holds one pixel per dot and the browser scales it up without smoothing, so a frame
 * computes about 150,000 dots instead of writing every device pixel (20 MB a frame on a Retina
 * screen, which kept the main thread busy and made the page stutter). It pauses while the tab is
 * hidden and draws a single still frame when the visitor asks for reduced motion.
 */
export function DitherField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    let image: ImageData | null = null;

    const resize = () => {
      canvas.width = Math.max(1, Math.ceil(canvas.clientWidth / DOT));
      canvas.height = Math.max(1, Math.ceil(canvas.clientHeight / DOT));
      image = ctx.createImageData(canvas.width, canvas.height);
    };

    const paint = (now: number) => {
      if (!image) return;
      const w = canvas.width;
      const h = canvas.height;
      const data = image.data;
      const t = now / 1400;
      for (let y = 0; y < h; y++) {
        const ny = y / h;
        const row = BAYER[y % 4];
        for (let x = 0; x < w; x++) {
          const nx = x / w;
          const wave = Math.sin(nx * 6 + t) * Math.cos(ny * 5 - t * 0.8);
          const ripple = Math.sin((nx + ny) * 10 + t * 1.4);
          const tone = (wave * 0.55 + ripple * 0.45 + 1) / 2;
          const ink = tone > (row[x % 4] + 0.5) / 16 ? 255 : 0;
          const i = (y * w + x) * 4;
          data[i] = ink;
          data[i + 1] = ink;
          data[i + 2] = ink;
          data[i + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (now - last < FRAME_MS) return;
      last = now;
      paint(now);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      if (still) paint(0);
      else if (!document.hidden) raf = requestAnimationFrame(frame);
    };

    resize();
    start();
    const observer = new ResizeObserver(() => {
      resize();
      if (still) paint(0);
    });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", start);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full [image-rendering:pixelated]" aria-hidden />;
}
