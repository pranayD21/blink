"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const KEY = "blink-trial";
const CHANGE = "blink-trial-change";

export function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  return () => window.removeEventListener(CHANGE, onChange);
}

export function snapshot() {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setTrial(value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, value);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE));
}

export function startTrial() {
  setTrial("0");
}

const STEPS = [
  {
    body: "Halvorsen's Q2 filing and the firm's compliance rules are loaded before anyone speaks.",
    button: "Start live call",
  },
  {
    body: "Ray mentions a 20% order drop without naming a company, so Blink stays quiet instead of raising a false alarm.",
    button: "Jump to Amber warning",
  },
  {
    body: "Priya asks for Halvorsen's unreported Q3 bookings. Her status pill turns Amber before Ray answers.",
    button: "Jump to Red leak",
  },
  {
    body: "Ray admits checking his old Halvorsen Salesforce login. The rule triggers Red and hides the quote.",
    button: "Review as compliance",
  },
  {
    body: "Compliance makes the final call on flagged quotes. Click Keep hidden from banker.",
    button: "Keep hidden from banker",
    target: "[data-demo='decide']",
    click: true,
  },
  {
    body: "Priya receives Ray's public steel remarks, with the Salesforce leak removed.",
    button: "Finish",
  },
] as const;

type Place = {
  arrived: boolean;
  selector: string | null;
  go: string | null;
  body: string;
  button: string;
  completesOnClick: boolean;
};

const found = (selector: string | null | undefined): HTMLElement | null => {
  if (!selector) return null;
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
};

function place(index: number, pathname: string): Place | null {
  if (pathname !== "/trial") {
    return {
      arrived: false,
      selector: null,
      go: "/trial",
      body: "Sit in on a realistic call between banker Priya Raman and former Halvorsen sales VP Ray Castellano.",
      button: "Open demo call",
      completesOnClick: false,
    };
  }
  const step = STEPS[index];
  if (!step) return null;
  const click = "click" in step && Boolean(step.click);
  const selector = "target" in step ? step.target : null;
  return {
    arrived: true,
    selector,
    go: null,
    body: step.body,
    button: step.button,
    completesOnClick: click,
  };
}

/** Minimal bottom pill bar that steps through the demo call without covering or crowding the page. */
export function TrialCoach() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const step = raw === null || raw === "" ? null : Number(raw);
  const hidden = pathname === "/" || pathname === "/login" || pathname.startsWith("/desktop");
  const active = step !== null && !hidden && !Number.isNaN(step);
  const [, setSeen] = useState(0);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => setSeen((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  }, [active, pathname, step]);

  const here = active && step !== null ? place(step, pathname) : null;

  useEffect(() => {
    if (active && step !== null && pathname === "/trial" && step >= STEPS.length) {
      setTrial(null);
    }
  }, [active, pathname, step]);

  useEffect(() => {
    if (!active || !here?.completesOnClick || !here.selector || step === null) return;
    const selector = here.selector;
    const onClick = (event: MouseEvent) => {
      const el = found(selector);
      if (el && event.target instanceof Node && el.contains(event.target)) {
        const next = step + 1;
        setTrial(next >= STEPS.length ? null : String(next));
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, here, step]);

  if (!active || !here || step === null) return null;

  function primary() {
    if (step === null) return;
    const current = place(step, pathname);
    if (!current) {
      setTrial(null);
      return;
    }
    if (!current.arrived && current.go) {
      router.push(current.go);
      return;
    }
    if (current.completesOnClick && current.selector) {
      found(current.selector)?.click();
      const next = step + 1;
      setTrial(next >= STEPS.length ? null : String(next));
      return;
    }
    const next = step + 1;
    setTrial(next >= STEPS.length ? null : String(next));
  }

  return (
    <aside
      data-trial="card"
      className="glass-surface fixed bottom-5 left-1/2 z-40 flex w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between gap-5 px-6 py-3.5"
      data-testid="trial-card"
      data-step={step}
      aria-live="polite"
    >
      <p className="sr-only">Step {Math.min(step + 1, STEPS.length)}</p>
      <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
        {Math.min(step + 1, STEPS.length)} / {STEPS.length}
      </span>
      <p className="min-w-0 flex-1 text-base leading-snug text-foreground">{here.body}</p>
      <div className="flex shrink-0 items-center gap-3">
        <button type="button" className="glass-press text-sm text-muted-foreground hover:text-foreground" onClick={() => setTrial(null)} data-testid="end-trial">
          Close
        </button>
        <Button type="button" className="h-10 px-5 text-base" onClick={primary} data-testid="trial-next">
          {here.button}
        </Button>
      </div>
    </aside>
  );
}
