"use client";

import Link from "next/link";
import { useState } from "react";
import { StatusDot } from "@/components/app/status-dot";
import { formatDateTime, plural, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { releasedBriefs } from "@/server/services/briefs";

type Released = ReturnType<typeof releasedBriefs>[number];

const AUDIENCE: Record<string, string> = { analyst: "Covering banker", investment_team: "Investment team" };

/** A released brief as the banker sees it: text, citation chips, and the quotes behind each citation. */
export function ReleasedBrief({ brief }: { brief: Released }) {
  const [selected, setSelected] = useState<string | null>(null);
  const citation = selected ? brief.citations.find((c) => c.key === selected) : null;

  return (
    <article className={cn("rounded-xl border bg-card", brief.standing !== "current" && "opacity-95")} data-testid="released-brief" data-standing={brief.standing}>
      <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <h2 className="text-base font-semibold text-foreground">{brief.case.title}</h2>
        <span className="text-sm text-muted-foreground">
          {brief.case.issuer} ({brief.case.ticker}) · brief v{brief.versionNo}
        </span>
        {brief.standing === "current" && <StatusDot tone="good" className="text-xs">Released</StatusDot>}
        <span className="ml-auto text-xs text-muted-foreground">
          {AUDIENCE[brief.audience] ?? brief.audience} · released {formatDateTime(brief.releasedAt)} · hash <span className="font-mono">{shortHash(brief.briefHash, 10)}</span>
        </span>
      </header>

      {brief.standing === "superseded" && (
        <div className="border-b bg-muted/50 px-5 py-2 text-sm text-foreground" data-testid="superseded-banner">
          <StatusDot tone="warn" className="items-start whitespace-normal [&>span:first-child]:mt-1.5">
            Superseded. A newer version of this brief has been released; use that one.
          </StatusDot>
        </div>
      )}
      {brief.standing === "under_re_review" && (
        <div className="border-b bg-muted/50 px-5 py-2 text-sm text-foreground" data-testid="re-review-banner">
          <StatusDot tone="stop" className="items-start whitespace-normal [&>span:first-child]:mt-1.5">
            Under re-review. The evidence behind this brief changed after it was released{brief.staleReason ? ` (${brief.staleReason})` : ""}. Do not rely on it until compliance releases an updated version.
          </StatusDot>
        </div>
      )}

      <div className="grid grid-cols-[1fr_18rem] gap-5 px-5 py-4">
        <div className="space-y-4">
          {brief.sections.map((section) => (
            <section key={section.heading}>
              <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
              <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-foreground">
                {section.sentences.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                    <span>
                      {s.text}
                      {s.claim_ids.map((id) => (
                        <button key={id} type="button" onClick={() => setSelected((cur) => (cur === id ? null : id))} data-testid={`citation-${id}`} className={cn("ml-1 inline-flex h-[18px] items-center rounded bg-muted px-1 font-mono text-[11px] font-medium text-foreground ring-1 ring-border ring-inset hover:bg-secondary", selected === id && "bg-primary text-primary-foreground ring-primary hover:bg-primary")}>
                          {id}
                        </button>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="border-t pt-3 text-sm">
            <Link href={`/analyst/${brief.releaseId}`} data-testid="read-transcript" className="font-medium text-foreground underline underline-offset-4">
              Read the transcript
            </Link>
          </p>
          <p className="text-sm font-medium text-muted-foreground" data-testid="withheld-note">
            {brief.withheldCount === 0 ? "No statements were withheld by compliance." : `${plural(brief.withheldCount, "statement")} withheld by compliance.`}
          </p>
        </div>
        <aside className="self-start rounded-lg bg-muted/60 p-3 text-sm">
          {citation ? (
            <>
              <div className="font-mono text-xs font-semibold text-foreground">{citation.key}</div>
              <p className="mt-1 text-foreground">{citation.summary}</p>
              <div className="mt-2 space-y-1.5">
                {citation.quotes.map((q, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    <span className="font-mono font-semibold text-muted-foreground">{q.turnLabel}</span> “{q.quote}”
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Every sentence cites the expert statements it rests on. Click a citation chip to read the exact quotes from the call.</p>
          )}
        </aside>
      </div>
    </article>
  );
}
