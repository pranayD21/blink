"use client";

import { useLayoutEffect, useRef, useState } from "react";

export interface TabOption<T extends string> {
  value: T;
  label: string;
  testId?: string;
}

/** Single-row glass pill bar whose active lens hugs the selected button without wrapping or stretching. */
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
  const [thumb, setThumb] = useState({ x: 0, y: 0, w: 0, h: 0, on: false });

  useLayoutEffect(() => {
    const bar = root.current;
    const current = bar?.querySelector<HTMLElement>("[data-active='true']");
    if (!bar || !current) {
      setThumb((prev) => ({ ...prev, on: false }));
      return;
    }
    const place = () => {
      setThumb({
        x: current.offsetLeft,
        y: current.offsetTop,
        w: current.offsetWidth,
        h: current.offsetHeight,
        on: true,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bar);
    observer.observe(current);
    return () => observer.disconnect();
  }, [value, options]);

  return (
    <div ref={root} role="tablist" aria-label={ariaLabel} data-testid={testId} className="glass-nav relative p-1 text-base">
      <span
        className="glass-nav-thumb"
        style={{
          transform: `translate(${thumb.x}px, ${thumb.y}px)`,
          width: thumb.w,
          height: thumb.h,
          opacity: thumb.on ? 1 : 0,
        }}
        aria-hidden
      />
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
            className={
              on
                ? "glass-press relative z-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 text-foreground"
                : "glass-press relative z-10 shrink-0 whitespace-nowrap px-3.5 py-1.5 text-muted-foreground"
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
