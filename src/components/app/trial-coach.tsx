"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const KEY = "blink-trial";
const CHANGE = "blink-trial-change";

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  return () => window.removeEventListener(CHANGE, onChange);
}

// Storage can throw (a browser set to block site data), and the guide runs on every page, so a
// failure there must mean "no trial", never a crashed page.
function snapshot() {
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
  { title: "A call becomes a case", lead: "Open Cases. Every expert call is a row in that queue.", arrived: "Each row is one call. This is where a run starts." },
  { title: "A policy has to be active", lead: "Open Policy. Blink evaluates a call only against an approved policy.", arrived: "The owner compiles the policy into rules and approves one version. Only that version is used. Until then, nothing is evaluated." },
  { title: "Open a case", lead: "Go to Cases and open one call.", arrived: "Open a case. The next screens are that call, step by step." },
  { title: "The transcript is the input", lead: "Open a case from the queue.", arrived: "The banker adds the transcript. Blink reads each claim and checks it against the policy." },
  { title: "A person decides each finding", lead: "Open a case. Findings are on the compliance view of that call.", arrived: "A finding is a concern plus the quote it rests on. A person decides it. Blink does not." },
  { title: "A brief cites every sentence", lead: "Open the case. The brief comes after the decisions.", arrived: "When every finding is decided, compliance attests. A brief is drafted. Every sentence cites a claim, and release checks that nothing restricted leaked." },
  { title: "The banker reads the release", lead: "Open Released briefs. This is what the banker is allowed to read.", arrived: "Released briefs leave out anything compliance kept hidden." },
  { title: "A live call is one button", lead: "Open Call. During a live call the banker sees one control.", arrived: "Blink listens and says when to move on. The words of the call are not shown." },
] as const;

type Place = {
  arrived: boolean;
  selector: string | null;
  go: string | null;
  button: string;
  completesOnClick: boolean;
  body: string;
};

const onCase = (pathname: string) => /^\/cases\/(?!new$)[^/]+$/.test(pathname);
const found = (selector: string) => document.querySelector<HTMLElement>(selector);

function place(index: number, pathname: string): Place {
  const step = STEPS[index];
  if (!step) {
    return { arrived: true, selector: null, go: null, button: "Finish", completesOnClick: false, body: "Policy, then the case, then the read, then a person's decision, then the brief, then the release. On a live call, Blink only says when to move on." };
  }
  const travel = (selector: string | null, go: string, body: string): Place => ({ arrived: false, selector, go, button: "Show me", completesOnClick: false, body });
  const look = (selector: string | null, body: string, completesOnClick = false): Place => ({ arrived: true, selector, go: null, button: completesOnClick ? "Click it" : "Next", completesOnClick, body });

  if (index === 0) {
    if (pathname !== "/cases") return travel(found("nav a[href='/cases']") ? "nav a[href='/cases']" : null, "/cases", step.lead);
    return look(found("[data-testid^='case-row-']") ? "[data-slot='table-container']" : "[data-testid='no-policy-banner']", step.arrived);
  }
  if (index === 1) {
    if (pathname !== "/policies" && !pathname.startsWith("/policies/")) {
      const link = "[data-testid='no-policy-banner'] a, nav a[href='/policies']";
      return travel(found(link) ? link : null, "/policies", step.lead);
    }
    return look(found("[data-slot='table-container']") ? "[data-slot='table-container']" : "main h1", step.arrived);
  }
  if (index === 2) {
    if (pathname !== "/cases") return travel(found("nav a[href='/cases']") ? "nav a[href='/cases']" : null, "/cases", step.lead);
    if (!found("[data-testid^='case-row-'] a")) return look(null, "No case is in the queue yet. A banker starts one from Call. Continue, and the rest of the run is the same.");
    return look("[data-testid^='case-row-'] a", step.arrived, true);
  }
  if (index === 3) {
    if (!onCase(pathname)) return travel(found("[data-testid^='case-row-'] a") ? "[data-testid^='case-row-'] a" : "nav a[href='/cases']", "/cases", step.lead);
    const findings = found("[data-testid='findings-pane']");
    const target = "[data-testid='transcript-text'], [data-testid='open-upload'], [data-testid='workspace'], [data-testid='case-status']";
    return look(found(target) ? target : null, findings ? "Compliance is in the review workspace. The transcript is on the left, and Blink has already checked it." : "The banker adds the transcript here. Blink reads each claim and checks it against the policy. The banker does not see the findings.");
  }
  if (index === 4) {
    if (!onCase(pathname)) return travel(found("[data-testid^='case-row-'] a") ? "[data-testid^='case-row-'] a" : "nav a[href='/cases']", "/cases", step.lead);
    if (found("[data-testid^='finding-']")) return look("[data-testid^='finding-']", step.arrived, true);
    return look(found("[data-testid='case-status']") ? "[data-testid='case-status']" : null, "On this view the banker never sees findings. Compliance opens the same case, sees each quote, and decides.");
  }
  if (index === 5) {
    if (pathname.endsWith("/brief")) return look(found("[data-testid='brief-status'], main h1") ? "[data-testid='brief-status'], main h1" : null, step.arrived);
    const link = found("[data-testid='link-brief']");
    if (link && onCase(pathname)) return travel("[data-testid='link-brief']", link.getAttribute("href") ?? pathname, "Open the brief. Every sentence has to cite a claim.");
    if (!onCase(pathname)) return travel(found("[data-testid^='case-row-'] a") ? "[data-testid^='case-row-'] a" : "nav a[href='/cases']", "/cases", step.lead);
    return look(found("[data-testid='case-status']") ? "[data-testid='case-status']" : null, step.arrived);
  }
  if (index === 6) {
    if (pathname !== "/analyst" && !pathname.startsWith("/analyst/")) return travel(found("nav a[href='/analyst']") ? "nav a[href='/analyst']" : null, "/analyst", step.lead);
    return look(found("[data-testid='released-brief'], [data-testid='no-released-briefs']") ? "[data-testid='released-brief'], [data-testid='no-released-briefs']" : "main h1", step.arrived);
  }
  if (pathname !== "/call") return travel(found("nav a[href='/call']") ? "nav a[href='/call']" : null, "/call", step.lead);
  return look(found("[data-testid='start-call'], [data-testid='not-a-banker'], [data-testid='agent-now']") ? "[data-testid='start-call'], [data-testid='not-a-banker'], [data-testid='agent-now']" : null, found("[data-testid='not-a-banker']") ? "Calls are started by the banker. One button, then Blink says when to move on. The words of the call stay hidden." : step.arrived);
}

/** A guided run. The highlighted control is the next click, and the card lists every step. */
export function TrialCoach() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const step = raw === null || raw === "" ? null : Number(raw);
  const hidden = pathname === "/" || pathname === "/login" || pathname.startsWith("/desktop");
  const active = step !== null && !hidden && !Number.isNaN(step);
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
      const el = here.selector ? document.querySelector<HTMLElement>(here.selector) : null;
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
      if (card) {
        const cardWidth = card.offsetWidth || 380;
        const overlaps = left < 24 + cardWidth && top > window.innerHeight - 480;
        card.style.left = overlaps ? `${Math.max(24, window.innerWidth - cardWidth - 24)}px` : "24px";
      }
    };
    apply();
    document.querySelector<HTMLElement>(here.selector ?? "")?.scrollIntoView({ block: "center", behavior: "smooth" });
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
      const el = document.querySelector(selector);
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
      router.push(current.go);
      return;
    }
    if (current.completesOnClick && current.selector) {
      document.querySelector<HTMLElement>(current.selector)?.click();
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
      <aside data-trial="card" className="glass-surface fixed bottom-6 left-6 z-[80] flex max-h-[70vh] w-[380px] flex-col px-6 py-5" data-testid="trial-card" data-step={step} aria-live="polite">
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
