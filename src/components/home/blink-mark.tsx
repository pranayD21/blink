import { cn } from "@/lib/utils";

/**
 * An eye, mid-blink. Ramp is a slope you walk up. Blink is the moment the eye closes,
 * so the mark is a single lid over a glass lens.
 */
export function BlinkMark({ large = false, word = true }: { large?: boolean; word?: boolean }) {
  return (
    <span className={cn("blink-mark inline-flex items-center", large ? "gap-5" : "gap-2.5")}>
      <span className={cn("blink-eye", large && "blink-eye-large")} aria-hidden>
        <span className="blink-lid" />
      </span>
      {word && <span className={cn("tracking-tight text-foreground", large ? "text-6xl" : "text-lg")}>blink</span>}
    </span>
  );
}
