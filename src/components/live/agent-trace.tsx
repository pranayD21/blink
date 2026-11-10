"use client";

export type AgentTone = "quiet" | "work" | "warn" | "stop";

export interface AgentBeat {
  text: string;
  tone: AgentTone;
}

/**
 * What the agent is doing on this call, one line at a time. Older lines stay, quieter,
 * so a demo can see the work without a dashboard.
 */
export function AgentTrace({ beats, hero = false }: { beats: AgentBeat[]; hero?: boolean }) {
  const current = beats.at(-1) ?? { text: hero ? "" : "Waiting for a call.", tone: "quiet" as const };
  const pinned = [...beats].reverse().find((beat) => beat.tone === "stop") ?? [...beats].reverse().find((beat) => beat.tone === "warn");

  return (
    <section className={hero ? "flex flex-col items-center text-center" : "relative flex min-h-0 flex-1 flex-col justify-end px-4 py-8"} data-testid="agent-trace">
      {pinned && pinned.text !== current.text && (
        <p className="mb-6 max-w-3xl text-2xl leading-snug text-foreground" data-testid="agent-pinned" data-tone={pinned.tone}>
          {pinned.text}
        </p>
      )}
      {current.text && (
        <p className={hero ? "max-w-3xl text-4xl leading-tight text-foreground md:text-5xl" : "max-w-3xl text-3xl leading-tight text-foreground"} data-testid="agent-now" data-tone={current.tone}>
          {current.text}
        </p>
      )}
    </section>
  );
}
