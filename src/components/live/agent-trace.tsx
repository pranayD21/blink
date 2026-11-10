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
export function AgentTrace({ beats }: { beats: AgentBeat[] }) {
  const current = beats.at(-1) ?? { text: "Waiting for a call.", tone: "quiet" as const };
  const pinned = [...beats].reverse().find((beat) => beat.tone === "stop") ?? [...beats].reverse().find((beat) => beat.tone === "warn");
  const earlier = beats.slice(0, -1).slice(-3);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col justify-end overflow-hidden border border-border bg-card px-4 py-5" data-testid="agent-trace">
      <div className="aurora-field" aria-hidden />
      {pinned && pinned !== current && (
        <p className="relative mb-4 font-serif text-lg leading-snug" data-testid="agent-pinned" data-tone={pinned.tone}>
          {pinned.text}
        </p>
      )}
      <ol className="relative space-y-1">
        {earlier.map((beat, i) => (
          <li key={`${i}-${beat.text}`} className="text-xs text-muted-foreground">
            {beat.text}
          </li>
        ))}
      </ol>
      <p className="relative mt-3 flex items-start gap-3 font-serif text-xl leading-snug text-foreground" data-testid="agent-now" data-tone={current.tone}>
        <span className={current.tone === "work" ? "agent-mark mt-2" : "agent-dot mt-2"} aria-hidden />
        <span className="agent-line">{current.text}</span>
      </p>
    </section>
  );
}
