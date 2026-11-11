"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { snapshot, startTrial, subscribe } from "@/components/app/trial-coach";

const TURNS = [
  { who: "Banker", text: "How are Northline’s distributors looking this quarter?" },
  { who: "Expert", text: "Demand is soft. Distributors are cautious." },
  { who: "Expert", text: "Distributor orders fell 15% this quarter.", hot: true },
  { who: "Banker", text: "Is that in the public numbers?" },
  { who: "Expert", text: "I think so. I saw it in the channel." },
];

const STATUS = ["Waiting to read the call.", "Pulled one claim out of the call.", "Compared 15% with the public filing.", "Flagged the mismatch.", "Waiting for you to decide.", "The note is ready."];

/** The sample call. Each trial step reveals the next thing Blink did. */
export function DemoRun() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => null);
  const step = raw === null || raw === "" || Number.isNaN(Number(raw)) ? null : Number(raw);
  const at = step === null ? -1 : step;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-6" data-testid="demo-run">
      <h1 className="text-3xl text-foreground">Northline Pumps</h1>
      <p className="mt-2 max-w-3xl text-lg leading-snug text-muted-foreground">A sample call, so you can watch Blink read one sentence.</p>

      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <section className="glass-surface px-7 py-6" data-demo="call">
          <h2 className="text-xl text-foreground">The call</h2>
          <ol className="mt-4 space-y-4">
            {TURNS.map((turn) => (
              <li key={turn.text} data-demo={turn.hot ? "sentence" : undefined} className={turn.hot && at >= 1 ? "rounded-2xl bg-muted px-4 py-3" : "px-4 py-3"}>
                <p className="text-base text-muted-foreground">{turn.who}</p>
                <p className="mt-1 text-lg leading-snug text-foreground">{turn.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="glass-surface px-7 py-6">
          <p className="text-base text-muted-foreground">Blink</p>
          <p className="mt-1 text-2xl text-foreground">{STATUS[Math.max(0, Math.min(at, STATUS.length - 1))]}</p>

          {at < 1 && (
            <div className="mt-6">
              <p className="text-lg leading-snug text-foreground">Nothing has been checked yet. Start the walkthrough and Blink will read the call from the top.</p>
              {step === null && (
                <Button type="button" className="mt-5" onClick={startTrial} data-testid="demo-start">
                  Walk me through this call
                </Button>
              )}
            </div>
          )}

          {at >= 1 && (
            <div className="mt-6 rounded-2xl bg-muted px-5 py-4">
              <p className="text-base text-muted-foreground">Claim Blink wrote down</p>
              <p className="mt-1 text-xl text-foreground">Distributor orders fell 15% this quarter.</p>
            </div>
          )}

          {at >= 2 && (
            <div className="mt-4" data-demo="check">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-muted px-5 py-4">
                  <p className="text-base text-muted-foreground">Expert said</p>
                  <p className="mt-1 text-xl text-foreground">Down 15%</p>
                </div>
                <div className="rounded-2xl bg-muted px-5 py-4">
                  <p className="text-base text-muted-foreground">Earnings release says</p>
                  <p className="mt-1 text-xl text-foreground">Down 4%</p>
                </div>
              </div>
              <p className="mt-3 text-lg text-foreground">These do not match.</p>
            </div>
          )}

          {at >= 3 && (
            <div className="mt-4 rounded-2xl bg-muted px-5 py-4" data-demo="finding">
              <p className="text-base text-muted-foreground">Flagged</p>
              <p className="mt-1 text-xl leading-snug text-foreground">“Distributor orders fell 15% this quarter.”</p>
              <p className="mt-2 text-lg leading-snug text-muted-foreground">The Q3 earnings release says 4%, not 15%.</p>
            </div>
          )}

          {at === 4 && (
            <Button type="button" className="mt-5" data-demo="decide" data-testid="demo-keep-hidden">
              Keep hidden
            </Button>
          )}

          {at >= 5 && (
            <div className="mt-4" data-demo="note">
              <p className="text-base text-muted-foreground">Kept hidden</p>
              <div className="mt-3 rounded-2xl bg-muted px-5 py-4">
                <p className="text-base text-muted-foreground">Note for the banker</p>
                <p className="mt-2 text-xl leading-snug text-foreground">Distributors are cautious and demand is soft.</p>
                <p className="mt-2 text-lg text-muted-foreground">Cited from the expert, on this call.</p>
              </div>
              <p className="mt-3 text-lg text-foreground">The 15% line is not in the note.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
