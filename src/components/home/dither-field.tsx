"use client";

import { useEffect, useRef } from "react";

const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** A moving black-and-white dither, the backdrop of the landing page. */
export function DitherField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;
    let raf = 0;
    const block = 5;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (now: number) => {
      const t = now / 1400;
      const w = canvas.width;
      const h = canvas.height;
      const image = ctx.createImageData(w, h);
      const data = image.data;
      for (let y = 0; y < h; y += block) {
        for (let x = 0; x < w; x += block) {
          const nx = x / w;
          const ny = y / h;
          const wave = Math.sin(nx * 6 + t) * Math.cos(ny * 5 - t * 0.8);
          const ripple = Math.sin((nx + ny) * 10 + t * 1.4);
          const value = wave * 0.55 + ripple * 0.45;
          const tone = (value + 1) / 2;
          const threshold = (BAYER[(y / block) % 4][(x / block) % 4] + 0.5) / 16;
          const ink = tone > threshold ? 255 : 0;
          for (let dy = 0; dy < block && y + dy < h; dy++) {
            for (let dx = 0; dx < block && x + dx < w; dx++) {
              const i = ((y + dy) * w + (x + dx)) * 4;
              data[i] = ink;
              data[i + 1] = ink;
              data[i + 2] = ink;
              data[i + 3] = 255;
            }
          }
        }
      }
      ctx.putImageData(image, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
