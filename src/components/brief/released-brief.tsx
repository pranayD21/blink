"use client";

import Link from "next/link";
import { useState } from "react";
import { Chip } from "@/components/app/status-chip";
import { formatDateTime, plural, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { releasedBriefs } from "@/server/services/briefs";

type Released = ReturnType<typeof releasedBriefs>[number];

const AUDIENCE: Record<string, string> = { analyst: "Covering analyst", investment_team: "Investment team" };

/** A released brief as the analyst sees it: text, citation chips, and the quotes behind each citation. */
export function ReleasedBrief({ brief }: { brief: Released }) {
  const [selected, setSelected] = useState<string | null>(null);
  const citation = selected ? brief.citations.find((c) => c.key === selected) : null;

  return (
    <article className={cn("rounded-xl border bg-white", brief.standing !== "current" && "opacity-95")} data-testid="released-brief" data-standing={brief.standing}>
      <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">{brief.case.title}</h2>
        <span className="text-sm text-slate-500">
          {brief.case.issuer} ({brief.case.ticker}) · brief v{brief.versionNo}
        </span>
        {brief.standing === "current" && <Chip tone="emerald">released</Chip>}
        <span className="ml-auto text-xs text-slate-500">
          {AUDIENCE[brief.audience] ?? brief.audience} · released {formatDateTime(brief.releasedAt)} · hash <span className="font-mono">{shortHash(brief.briefHash, 10)}</span>
        </span>
      </header>

      {brief.standing === "superseded" && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900" data-testid="superseded-banner">
          Superseded. A newer version of this brief has been released; use that one.
        </div>
      )}
      {brief.standing === "under_re_review" && (
        <div className="border-b border-red-200 bg-red-50 px-5 py-2 text-sm text-red-900" data-testid="re-review-banner">
          Under re-review. The evidence behind this brief changed after it was released{brief.staleReason ? ` (${brief.staleReason})` : ""}. Do not rely on it until compliance releases an updated version.
        </div>
      )}

      <div className="grid grid-cols-[1fr_18rem] gap-5 px-5 py-4">
        <div className="space-y-4">
          {brief.sections.map((section) => (
            <section key={section.heading}>
              <h3 className="text-sm font-semibold text-slate-900">{section.heading}</h3>
              <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-slate-800">
                {section.sentences.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-slate-300" />
                    <span>
                      {s.text}
                      {s.claim_ids.map((id) => (
                        <button key={id} type="button" onClick={() => setSelected((cur) => (cur === id ? null : id))} data-testid={`citation-${id}`} className={cn("ml-1 inline-flex h-[18px] items-center rounded bg-indigo-50 px-1 font-mono text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-200 ring-inset hover:bg-indigo-100", selected === id && "bg-indigo-600 text-white ring-indigo-600 hover:bg-indigo-600")}>
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
            <Link href={`/analyst/${brief.releaseId}`} data-testid="read-transcript" className="font-medium text-indigo-700 underline-offset-4 hover:underline">
              Read the transcript
            </Link>
          </p>
          <p className="text-sm font-medium text-slate-600" data-testid="withheld-note">
            {brief.withheldCount === 0 ? "No statements were withheld by compliance." : `${plural(brief.withheldCount, "statement")} withheld by compliance.`}
          </p>
        </div>
        <aside className="rounded-lg bg-slate-50 p-3 text-sm">
          {citation ? (
            <>
              <div className="font-mono text-xs font-semibold text-indigo-700">{citation.key}</div>
              <p className="mt-1 text-slate-800">{citation.summary}</p>
              <div className="mt-2 space-y-1.5">
                {citation.quotes.map((q, i) => (
                  <p key={i} className="text-xs text-slate-600">
                    <span className="font-mono font-semibold text-slate-500">{q.turnLabel}</span> “{q.quote}”
                  </p>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Every sentence cites the expert statements it rests on. Click a citation chip to read the exact quotes from the call.</p>
          )}
        </aside>
      </div>
    </article>
  );
}
