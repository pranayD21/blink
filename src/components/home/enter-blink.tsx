"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BlinkMark } from "./blink-mark";

/** The glass plate on the landing page. The press plays, then the app opens. */
export function EnterBlink() {
  const router = useRouter();
  const [pressed, setPressed] = useState(false);

  function enter(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    if (pressed) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setPressed(true);
    window.setTimeout(() => router.push("/cases"), reduce ? 0 : 420);
  }

  return (
    <Link href="/cases" onClick={enter} className={pressed ? "glass-reveal is-pressed" : "glass-reveal"} aria-label="Enter Blink" data-testid="enter-blink">
      <BlinkMark large />
    </Link>
  );
}
