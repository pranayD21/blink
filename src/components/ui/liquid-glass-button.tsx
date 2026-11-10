"use client";

import { cn } from "@/lib/utils";

/**
 * The one glass control. The refraction is an SVG filter, and the surface uses the theme
 * so it stays with the rest of the app in light and dark.
 */
export function LiquidButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cn("glass-button relative inline-flex h-11 items-center justify-center px-5 text-sm text-foreground", className)} {...props}>
      <span className="glass-button-sheen" aria-hidden />
      <span className="relative">{children}</span>
      <GlassFilter />
    </button>
  );
}

function GlassFilter() {
  return (
    <svg className="pointer-events-none absolute h-0 w-0" aria-hidden>
      <defs>
        <filter id="container-glass" x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.05" numOctaves="1" seed="1" result="turbulence" />
          <feGaussianBlur in="turbulence" stdDeviation="2" result="blurredNoise" />
          <feDisplacementMap in="SourceGraphic" in2="blurredNoise" scale="40" xChannelSelector="R" yChannelSelector="B" result="displaced" />
          <feGaussianBlur in="displaced" stdDeviation="3" result="finalBlur" />
          <feComposite in="finalBlur" in2="finalBlur" operator="over" />
        </filter>
      </defs>
    </svg>
  );
}
