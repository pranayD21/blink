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

// Storage can throw (a browser set to block site data), and the guide runs on every page, so a
// failure there must mean "no trial", never a crashed page.
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
  { title: "Read the call", body: "This is a sample call about Northline Pumps. A banker is asking an expert how the quarter is going. Blink has not read it yet.", target: "[data-demo='call']" },
  { title: "Blink reads one sentence", body: "Blink stopped on “Distributor orders fell 15% this quarter.” It wrote that down as a claim: one thing the expert said that can be checked.", target: "[data-demo='sentence']" },
  { title: "Blink checks the filing", body: "Northline’s earnings release says orders were down 4%. The expert said 15%. Those are different numbers, so Blink flags the sentence.", target: "[data-demo='check']" },
  { title: "Here is the flag", body: "The flag keeps the expert’s exact words next to the filing. A person decides what happens next. Blink does not hide or clear anything by itself.", target: "[data-demo='finding']" },
  { title: "Keep the 15% line hidden", body: "Click Keep hidden. The banker will not see the 15% line in the note.", target: "[data-demo='decide']", click: true },
  { title: "This is what the banker reads", body: "The note says demand is soft, and it cites the expert. The 15% line is not in it. One statement was kept hidden.", target: "[data-demo='note']" },
] as const;

const DONE = "That was one call. Blink read a number, checked it against the public filing, and flagged the mismatch. You kept the 15% line hidden. The banker only received the part that was safe.";

type Place = {
  arrived: boolean;
  selector: string | null;
  go: string | null;
  button: string;
  completesOnClick: boolean;
  body: string;
};

// Never throws: an empty or invalid selector finds nothing. querySelector("") throws, and a step
// with nothing to highlight has no selector.
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
    return { arrived: false, selector: null, go: "/trial", button: "Open the sample call", completesOnClick: false, body: "We’ll use a sample call about Northline Pumps. Blink will read one sentence and check it against the company’s public filing." };
  }
  const step = STEPS[index];
  if (!step) return { arrived: true, selector: "[data-demo='note']", go: null, button: "Finish", completesOnClick: false, body: DONE };
  const click = "click" in step && step.click;
  return { arrived: true, selector: step.target, go: null, button: click ? "Keep hidden" : "Next", completesOnClick: click, body: step.body };
}

/** A guided run of the Northline sample call. The highlighted control is the next click. */
export function TrialCoach() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const step = raw === null || raw === "" ? null : Number(raw);
  const hidden = pathname === "/" || pathname === "/login" || pathname.startsWith("/desktop");
  const active = step !== null && !hidden && !Number.isNaN(step);
  // place() reads the page. On a client navigation this render can run before the new page is on
  // screen, so read it again once it has been painted (and once more for content that streams in).
  const [, setSeen] = useState(0);
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => setSeen((n) => n + 1));
    const later = window.setTimeout(() => setSeen((n) => n + 1), 400);
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
      const dock = document.querySelector<HTMLElement>("[data-trial-dock]");
      if (card && dock) {
        const place = dock.getBoundingClientRect();
        card.style.top = `${place.top}px`;
        card.style.left = `${place.left}px`;
        card.style.width = `${place.width}px`;
        card.style.bottom = "auto";
        card.style.maxHeight = `${place.height}px`;
        card.style.visibility = "visible";
      } else if (card) {
        card.style.visibility = pathname === "/trial" ? "hidden" : "visible";
      }
    };
    apply();
    found(here.selector)?.scrollIntoView({ block: "center", behavior: "smooth" });
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
      <aside data-trial="card" className="glass-surface fixed bottom-6 right-6 z-[80] flex max-h-[70vh] w-[380px] flex-col overflow-y-auto px-6 py-5" data-testid="trial-card" data-step={step} aria-live="polite" style={pathname === "/trial" ? { visibility: "hidden" } : undefined}>
        <p className="text-base text-muted-foreground">{step >= STEPS.length ? "The run" : `Step ${step + 1} of ${STEPS.length}`}</p>
        <h2 className="mt-1 text-2xl text-foreground">{step >= STEPS.length ? "That is a Blink run" : STEPS[step].title}</h2>
        <p className="mt-2 text-lg leading-snug text-foreground">{here.body}</p>
        <ol className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto text-base">
          {STEPS.map((item, index) => (
            <li key={item.title} className={index === step ? "text-foreground" : "text-muted-foreground"}>
              <span className="tabular-nums">{index + 1}.</span> {item.title}
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" className="text-base text-muted-foreground" onClick={() => setTrial(null)} data-testid="end-trial">
            End trial
          </button>
          <Button type="button" onClick={primary} data-testid="trial-next">
            {here.button}
          </Button>
        </div>
      </aside>
    </>
  );
}
