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
    title: "How Blink works",
    body: "Blink loads Halvorsen's public filings and turns the firm's compliance rules into state machines before the call begins.",
    target: "[data-demo='workflow']",
    button: "Sit in on the call",
  },
  {
    title: "Listening to the call",
    body: "Priya and Ray are speaking now. When Ray mentions a 20% drop without naming a company, Blink waits for context instead of raising a false alarm.",
    target: "[data-demo='live-room']",
    button: "Jump to Amber warning",
  },
  {
    title: "Amber before Ray answers",
    body: "Priya asks for Halvorsen's own unreported Q3 numbers. Her status pill turns Amber right away so she can steer the conversation away.",
    target: "[data-demo='pill']",
    button: "See Red & state machine",
  },
  {
    title: "Red leak & state machine",
    body: "Ray reveals he checked his old Halvorsen Salesforce login (-19.8% Q3 bookings). Every condition on the rule is met, flipping the pill Red.",
    target: "[data-demo='engine']",
    button: "Review as compliance",
  },
  {
    title: "A human makes the call",
    body: "Blink holds the flagged quote out of Priya's reach until compliance decides. Click Keep hidden from banker.",
    target: "[data-demo='decide']",
    button: "Keep hidden from banker",
    click: true,
  },
  {
    title: "Safe brief for Priya",
    body: "Priya receives a cited summary of Ray's public steel remarks (+12%), with the Salesforce leak blanked out of her transcript.",
    target: "[data-demo='note']",
    button: "Next",
  },
] as const;

const DONE = "That is a complete Blink run: rules loaded before the call, live Amber and Red warnings while speaking, human review on flagged quotes, and a clean brief with restricted lines removed.";

type Place = {
  arrived: boolean;
  selector: string | null;
  go: string | null;
  button: string;
  completesOnClick: boolean;
  body: string;
};

const found = (selector: string | null | undefined): HTMLElement | null => {
  if (!selector) return null;
  try {
    return document.querySelector<HTMLElement>(selector);
  } catch {
    return null;
  }
};

function place(index: number, pathname: string): Place {
  if (pathname !== "/trial") {
    return {
      arrived: false,
      selector: null,
      go: "/trial",
      button: "Open sample call",
      completesOnClick: false,
      body: "Sit in on a realistic call between banker Priya Raman and former Halvorsen sales VP Ray Castellano.",
    };
  }
  const step = STEPS[index];
  if (!step) return { arrived: true, selector: "[data-demo='note']", go: null, button: "Finish", completesOnClick: false, body: DONE };
  const click = "click" in step && step.click;
  return { arrived: true, selector: step.target, go: null, button: step.button, completesOnClick: click, body: step.body };
}

/** Guided walkthrough of the Halvorsen live call, state machine, and safe brief. */
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
    const later = window.setTimeout(() => setSeen((n) => n + 1), 350);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(later);
    };
  }, [active, pathname, step]);

  const here = active ? place(step, pathname) : null;

  useEffect(() => {
    if (!active || !here || step === null) return;
    const nodes = {
      full: document.querySelector<HTMLElement>("[data-trial='full']"),
      top: document.querySelector<HTMLElement>("[data-trial='top']"),
      left: document.querySelector<HTMLElement>("[data-trial='left']"),
      right: document.querySelector<HTMLElement>("[data-trial='right']"),
      bottom: document.querySelector<HTMLElement>("[data-trial='bottom']"),
      ring: document.querySelector<HTMLElement>("[data-trial='ring']"),
      card: document.querySelector<HTMLElement>("[data-trial='card']"),
    };
    const apply = () => {
      const el = found(here.selector);
      const card = nodes.card;
      const dock = document.querySelector<HTMLElement>("[data-trial-dock]");
      if (card && dock) {
        const placeRect = dock.getBoundingClientRect();
        card.style.top = `${Math.max(16, placeRect.top)}px`;
        card.style.left = `${placeRect.left}px`;
        card.style.width = `${placeRect.width}px`;
        card.style.bottom = "auto";
        card.style.maxHeight = "calc(100vh - 6rem)";
        card.style.visibility = "visible";
      } else if (card) {
        card.style.visibility = pathname === "/trial" ? "hidden" : "visible";
      }

      const showHole = (on: boolean) => {
        for (const key of ["top", "left", "right", "bottom", "ring"] as const) {
          if (nodes[key]) nodes[key].style.display = on ? "block" : "none";
        }
        if (nodes.full) nodes.full.style.display = on ? "none" : "block";
      };
      if (!el) {
        showHole(false);
        return;
      }
      const rect = el.getBoundingClientRect();
      const pad = 8;
      const top = Math.max(8, rect.top - pad);
      const left = Math.max(8, rect.left - pad);
      const width = rect.width + pad * 2;
      const height = rect.height + pad * 2;
      showHole(true);
      if (nodes.top) nodes.top.style.height = `${top}px`;
      if (nodes.left) {
        nodes.left.style.top = `${top}px`;
        nodes.left.style.width = `${left}px`;
        nodes.left.style.height = `${height}px`;
      }
      if (nodes.right) {
        nodes.right.style.top = `${top}px`;
        nodes.right.style.left = `${left + width}px`;
        nodes.right.style.height = `${height}px`;
      }
      if (nodes.bottom) nodes.bottom.style.top = `${top + height}px`;
      if (nodes.ring) {
        nodes.ring.style.top = `${top}px`;
        nodes.ring.style.left = `${left}px`;
        nodes.ring.style.width = `${width}px`;
        nodes.ring.style.height = `${height}px`;
      }
    };
    apply();
    found(here.selector)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    window.addEventListener("resize", apply);
    window.addEventListener("scroll", apply, true);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("scroll", apply, true);
    };
  }, [active, here, step, pathname]);

  useEffect(() => {
    if (!active || !here?.completesOnClick || !here.selector || step === null) return;
    const selector = here.selector;
    const onClick = (event: MouseEvent) => {
      const el = found(selector);
      if (el && event.target instanceof Node && el.contains(event.target)) setTrial(String(step + 1));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, here, step]);

  if (!active || !here || step === null) return null;

  function primary() {
    if (step === null) return;
    if (step >= STEPS.length) {
      setTrial(null);
      return;
    }
    const current = place(step, pathname);
    if (!current.arrived && current.go) {
      if (current.go === pathname) setTrial(String(step + 1));
      else router.push(current.go);
      return;
    }
    if (current.completesOnClick && current.selector) {
      found(current.selector)?.click();
      setTrial(String(step + 1));
      return;
    }
    setTrial(String(step + 1));
  }

  return (
    <>
      <div data-trial="full" className="trial-dim" style={{ inset: 0 }} />
      <div data-trial="top" className="trial-dim" style={{ top: 0, left: 0, right: 0, display: "none" }} />
      <div data-trial="left" className="trial-dim" style={{ left: 0, display: "none" }} />
      <div data-trial="right" className="trial-dim" style={{ right: 0, display: "none" }} />
      <div data-trial="bottom" className="trial-dim" style={{ left: 0, right: 0, bottom: 0, display: "none" }} />
      <div data-trial="ring" className="trial-ring" style={{ display: "none" }} />
      <aside
        data-trial="card"
        className="glass-surface fixed bottom-6 right-6 z-[80] flex max-h-[75vh] w-[380px] flex-col overflow-y-auto px-6 py-5"
        data-testid="trial-card"
        data-step={step}
        aria-live="polite"
        style={pathname === "/trial" ? { visibility: "hidden" } : undefined}
      >
        <p className="text-base text-muted-foreground">{step >= STEPS.length ? "Complete" : `Step ${step + 1} of ${STEPS.length}`}</p>
        <h2 className="mt-1 text-2xl text-foreground">{step >= STEPS.length ? "That is a Blink run" : STEPS[step].title}</h2>
        <p className="mt-2.5 text-lg leading-snug text-foreground">{here.body}</p>
        <div className="mt-6 flex items-center justify-between gap-3">
          <button type="button" className="glass-press text-base text-muted-foreground hover:text-foreground" onClick={() => setTrial(null)} data-testid="end-trial">
            End walkthrough
          </button>
          <Button type="button" onClick={primary} data-testid="trial-next">
            {here.button}
          </Button>
        </div>
      </aside>
    </>
  );
}
