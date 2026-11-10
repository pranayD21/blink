import { EmptyState, PageShell, Panel, Stat } from "@/components/app/page-shell";
import { RoleGate } from "@/components/app/role-gate";
import { Chip } from "@/components/app/status-chip";
import { formatDateTime, formatMinutes, formatPercent, formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEMO_USERS } from "@/server/auth/actor";
import { pageActor } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { type StageMetrics, metricsFor } from "@/server/services/metrics";

const STAGE_LABEL: Record<string, string> = { extract: "Claim extraction", docfacts: "Document facts", brief: "Brief draft", policy_pass_a: "Policy: clause inventory", policy_pass_b: "Policy: typed rules", policy_assembly: "Policy: monitor assembly", policy_scenarios: "Policy: AI scenarios" };

export default async function MetricsPage() {
  const actor = await pageActor();
  if (actor.role === "analyst") {
    return <RoleGate title="Metrics are for compliance" message="They name every case and count its findings, which only compliance reviewers may read." current={actor} switchTo={DEMO_USERS.filter((u) => u.role !== "analyst")} />;
  }
  const m = metricsFor(getDb(), actor);
  if (m.scope === "stages") {
    return (
      <PageShell title="Metrics" description="Model cost and latency per stage, measured from the calls the app recorded. Review times and findings are for compliance reviewers.">
        <CostPanel llm={m.llm} />
      </PageShell>
    );
  }
  const { blink, baseline, savedFraction, moreCallsFraction, target } = m.reviewTime;
  // Cases with an unpriced call are left out of the average rather than counted low.
  const pricedCases = m.llm.perCase.filter((c) => c.unpricedCalls === 0);
  const perCallCost = pricedCases.length > 0 ? pricedCases.reduce((n, c) => n + c.costUsd, 0) / pricedCases.length : null;

  return (
    <PageShell title="Metrics" description="Everything here is measured from what the app recorded: review sessions, corrections, model calls, and the eval run.">
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900" data-testid="synthetic-note">
        Synthetic fixtures. These numbers show the measurement works. They are not production accuracy.
      </div>

      <div className="mb-5 grid grid-cols-4 gap-3">
        <Stat label="Review time with Blink" value={formatMinutes(blink.avgMs)} hint={blink.cases > 0 ? `average over ${blink.cases} case(s), active minutes` : "no review timed yet"} />
        <Stat label="Review time, baseline mode" value={formatMinutes(baseline.avgMs)} hint={baseline.cases > 0 ? `average over ${baseline.cases} case(s)` : "open a case's Baseline page to time one"} />
        <Stat label="Time saved" value={savedFraction === null ? "—" : formatPercent(savedFraction)} hint={moreCallsFraction !== null ? `= ${formatPercent(moreCallsFraction)} more calls at the same review hours` : "needs one Blink and one baseline review"} />
        <Stat label="Model cost per call" value={perCallCost === null ? (m.llm.perCase.length > 0 ? "unknown" : "—") : formatUsd(perCallCost)} hint={`${m.llm.anyReplayed ? "recorded token counts × list price" : "real tokens × list price"}${m.llm.unpricedCalls > 0 ? `; ${m.llm.unpricedCalls} call(s) have no listed price and are not counted` : ""}`} />
      </div>

      <div className="grid grid-cols-2 items-start gap-4">
        <Panel title="The pitch number, and where it comes from">
          <p className="text-sm text-slate-700" data-testid="pilot-target">
            Pilot target: <span className="font-semibold">{formatPercent(target.savedFraction)} less review time</span> per call. With the same compliance hours that is <span className="font-semibold">{formatPercent(target.moreCallsFraction)} more calls</span>.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            If a review takes a fraction <span className="font-mono">s</span> less time, the same hours cover <span className="font-mono">1 / (1 − s) − 1</span> more calls. The target is a goal for a pilot, not a result. The measured figure above is from this machine&apos;s timed sessions only.
          </p>
          {(blink.perCase.length > 0 || baseline.perCase.length > 0) && (
            <table className="mt-3 w-full text-xs">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-1 font-medium">Case</th>
                  <th className="py-1 font-medium">Blink</th>
                  <th className="py-1 font-medium">Baseline</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...new Set([...blink.perCase, ...baseline.perCase].map((c) => c.caseId))].map((id) => (
                  <tr key={id} className="border-t border-slate-100">
                    <td className="py-1 text-slate-700">{[...blink.perCase, ...baseline.perCase].find((c) => c.caseId === id)?.title}</td>
                    <td className="py-1">{formatMinutes(blink.perCase.find((c) => c.caseId === id)?.activeMs)}</td>
                    <td className="py-1">{formatMinutes(baseline.perCase.find((c) => c.caseId === id)?.activeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Reviewer corrections per case" bodyClassName="p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                {["Case", "Policy findings", "Field corrections", "Findings added by a reviewer", "AI suggestions dismissed"].map((h) => (
                  <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {m.corrections.map((c) => (
                <tr key={c.caseId} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 text-slate-800">{c.title}</td>
                  <td className="px-3 py-1.5">{c.policyFindings}</td>
                  <td className="px-3 py-1.5">{c.claimCorrections}</td>
                  <td className="px-3 py-1.5">{c.reviewerFindings}</td>
                  <td className="px-3 py-1.5">
                    {c.aiSuggestionsDismissed} of {c.aiSuggestions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-3 py-2 text-xs text-slate-500">A proxy for extraction quality: what a reviewer had to fix or add by hand.</p>
        </Panel>

        <CostPanel llm={m.llm} />

        <Panel title="Quote validity">
          <div className="text-2xl font-semibold text-slate-900 tabular-nums">{m.quotes.rate === null ? "—" : formatPercent(m.quotes.rate, 1)}</div>
          <p className="mt-1 text-sm text-slate-600">{m.quotes.proposed > 0 ? `${m.quotes.valid} of ${m.quotes.proposed} quotes proposed by the model were found character for character in the transcript.` : "No AI extraction has run yet."}</p>
          <p className="mt-2 text-xs text-slate-500">A quote that cannot be found is dropped, and a claim with no valid quote is rejected. Nothing ungrounded reaches a reviewer.</p>
        </Panel>
      </div>

      <Panel title="Gold-label recall and precision, per fixture" className="mt-4" bodyClassName="p-0" action={m.eval ? <span className="text-xs text-slate-500">pnpm eval · {m.eval.mode} mode · {m.eval.model} · {formatDateTime(m.eval.storedAt)}</span> : null}>
        {!m.eval ? (
          <EmptyState className="m-4">
            No eval run stored. Run <code className="font-mono">pnpm eval</code>.
          </EmptyState>
        ) : (
          <table className="w-full text-sm" data-testid="eval-table">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                {["Fixture", "Claims", "Quotes valid", "Expected findings", "Found", "Extra", "Recall", "Precision", "Assertions", "Notes"].map((h) => (
                  <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {m.eval.fixtures.map((f) => {
                const notes = [...f.missed.map((x) => `missed ${x}`), ...f.extra.map((x) => `extra ${x}`), ...f.stateMismatches, ...f.assertionFailures, ...(f.comparisons ?? []).filter((c) => !c.ok).map((c) => `comparison at ${c.turn}: got ${c.actual ?? "none"}`)];
                return (
                  <tr key={f.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-1.5">
                      <span className="font-mono text-xs font-semibold text-slate-900">{f.id}</span> <span className="text-slate-600">{f.title}</span>
                    </td>
                    {f.status === "error" ? (
                      <td colSpan={9} className="px-3 py-1.5 text-red-700">
                        Could not run: {f.error}
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-1.5">{f.claims}</td>
                        <td className="px-3 py-1.5">
                          {f.quotes.valid}/{f.quotes.proposed}
                        </td>
                        <td className="px-3 py-1.5">{f.expectedFindings}</td>
                        <td className="px-3 py-1.5">{f.matchedFindings}</td>
                        <td className={cn("px-3 py-1.5", f.extraFindings > 0 && "text-amber-700")}>{f.extraFindings}</td>
                        <td className="px-3 py-1.5">{f.recall === null ? "n/a" : `${f.matchedFindings}/${f.expectedFindings}`}</td>
                        <td className="px-3 py-1.5">{f.precision === null ? "n/a" : `${f.matchedFindings}/${f.matchedFindings + f.extraFindings}`}</td>
                        <td className="px-3 py-1.5">{f.assertionsTotal > 0 ? `${f.assertionsPassed}/${f.assertionsTotal}` : "—"}</td>
                        <td className="px-3 py-1.5 text-xs">{notes.length === 0 ? <Chip tone="emerald">as expected</Chip> : <span className="text-amber-800">{notes.join("; ")}</span>}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="border-t px-3 py-2 text-xs text-slate-500">Shown per fixture with counts, never as one accuracy figure. Policy and document facts are the hand-written fixtures here, so the result reflects extraction only.</p>
      </Panel>

      <Panel title="Missed concerns" className="mt-4">
        {!m.eval ? (
          <p className="text-sm text-slate-500">Needs an eval run.</p>
        ) : m.missedConcerns.length === 0 ? (
          <p className="text-sm text-slate-700" data-testid="missed-none">
            None: every gold finding in the {m.eval.fixtures.length} fixtures has a Blink finding.
          </p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-red-800">
            {m.missedConcerns.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </Panel>
    </PageShell>
  );
}

/** Model cost and latency per stage. Names no case, so the policy owner sees it too. */
function CostPanel({ llm }: { llm: StageMetrics["llm"] }) {
  return (
    <Panel title="Cost and latency per stage" bodyClassName="p-0">
      {llm.stages.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">No model call has been made yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-600">
            <tr>
              {["Stage", "Calls", "Input tokens", "Output tokens", "Avg latency", "Avg cost"].map((h) => (
                <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {llm.stages.map((s) => (
              <tr key={s.stage} className="border-t border-slate-100">
                <td className="px-3 py-1.5 text-slate-800">
                  {STAGE_LABEL[s.stage] ?? s.stage}
                  {s.replayed > 0 && <span className="ml-1.5 text-xs text-sky-700">{s.replayed === s.calls ? "replayed" : `${s.replayed} replayed`}</span>}
                </td>
                <td className="px-3 py-1.5">{s.calls}</td>
                <td className="px-3 py-1.5">{s.inputTokens.toLocaleString("en-US")}</td>
                <td className="px-3 py-1.5">{s.outputTokens.toLocaleString("en-US")}</td>
                <td className="px-3 py-1.5">{(s.avgLatencyMs / 1000).toFixed(1)} s</td>
                <td className="px-3 py-1.5">{s.avgCostUsd === null ? "unknown" : formatUsd(s.avgCostUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="border-t px-3 py-2 text-xs text-slate-500">
        Tokens × the list price of each model (Claude Opus 5.5 $4 / $20, Claude Haiku 5.5 $0.10 / $0.50 per million input / output tokens). A model with no listed price shows as unknown. {llm.anyReplayed ? "Replayed calls show the tokens and latency of the recorded run; no money was spent replaying them." : ""}
      </p>
    </Panel>
  );
}
