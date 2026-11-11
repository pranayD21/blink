"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  testId?: string;
}

/** A glass pill bar whose active lens slides smoothly between options. */
export function SlidingTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  testId,
}: {
  options: readonly TabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  testId?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ x: 0, w: 0, on: false });

  useLayoutEffect(() => {
    const bar = root.current;
    const current = bar?.querySelector<HTMLElement>("[data-active='true']");
    if (!bar || !current) {
      setThumb((prev) => ({ ...prev, on: false }));
      return;
    }
    const place = () => {
      const from = bar.getBoundingClientRect();
      const to = current.getBoundingClientRect();
      setThumb({ x: to.left - from.left, w: to.width, on: true });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div ref={root} role="tablist" aria-label={ariaLabel} data-testid={testId} className="glass-nav relative inline-flex flex-wrap items-center p-1 text-base">
      <span className="glass-nav-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w, opacity: thumb.on ? 1 : 0 }} aria-hidden />
      {options.map((opt) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={on}
            data-active={on}
            data-testid={opt.testId}
            onClick={() => onChange(opt.value)}
            className={on ? "glass-press relative z-10 px-4 py-1.5 text-foreground" : "glass-press relative z-10 px-4 py-1.5 text-muted-foreground"}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
