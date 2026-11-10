"use client";

import { AlertTriangle, CheckCircle2, ShieldCheck, Sparkles, UserRound, Wrench, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { JobProgress } from "@/components/app/job-progress";
import { MarkdownLite } from "@/components/app/markdown-lite";
import { Panel } from "@/components/app/page-shell";
import { Chip, StateChip } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ScenarioReport } from "@/core/policy/scenarios";
import { api, errorMessage } from "@/lib/api";
import { formatCount, formatDateTime, humanize, plural, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { policyDetail } from "@/server/services/policies";
import { MonitorGraph } from "./monitor-graph";

type Detail = ReturnType<typeof policyDetail>;

const ON_TRUE: Record<string, string> = { open_review: "open review", open_review_and_escalate: "open review and escalate to a senior compliance officer" };
const ON_INDETERMINATE: Record<string, string> = { open_context_task: "ask for the missing context first", open_review: "send to review as it stands" };
const STAGE_LABEL: Record<string, string> = { pass_a: "Pass A · clause inventory", pass_b: "Pass B · typed rules", assembly: "Assembly · monitors", scenarios: "AI scenarios", manual: "Manual fallback loaded" };

/** The paragraph text with each inventoried clause highlighted where code located it. */
function HighlightedParagraph({ text, clauses }: { text: string; clauses: { clause_id: string; verbatim: string; supported: boolean }[] }) {
  const spans = clauses
    .map((c) => ({ c, at: text.indexOf(c.verbatim) }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => a.at - b.at);
  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (const { c, at } of spans) {
    if (at < cursor) continue;
    if (at > cursor) out.push(text.slice(cursor, at));
    out.push(
      <mark key={c.clause_id} className={cn("rounded px-0.5", c.supported ? "bg-indigo-100/70 text-slate-900" : "bg-amber-100/80 text-slate-900")}>
        <sup className="mr-0.5 font-mono text-[10px] font-semibold text-indigo-700">{c.clause_id}</sup>
        {c.verbatim}
      </mark>,
    );
    cursor = at + c.verbatim.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

function ScenarioList({ report }: { report: ScenarioReport }) {
  return (
    <ul className="space-y-2">
      {report.results.map((r, i) => (
        <li key={i} className={cn("rounded-lg border bg-white px-3 py-2", !r.pass && (report.source === "reviewer" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"))} data-testid="scenario" data-pass={r.pass}>
          <div className="flex items-start gap-2 text-sm">
            {r.pass ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className={cn("mt-0.5 size-4 shrink-0", report.source === "reviewer" ? "text-red-600" : "text-amber-600")} />}
            <span className="font-medium text-slate-900">{r.name}</span>
            <span className="ml-auto shrink-0 font-mono text-xs text-slate-500">{r.resolved_rule_id ?? r.rule_id}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 pl-6 text-xs text-slate-600">
            {r.steps.map((s, j) => (
              <span key={j} className="inline-flex items-center gap-1">
                {j === 0 && <StateChip state={s.state_before} />}
                <span className="text-slate-400">
                  —{s.event === "CONTEXT_UPDATED" ? "context" : "claim"} · {s.result}→
                </span>
                <StateChip state={s.state_after} />
              </span>
            ))}
            {r.steps.at(-1) && r.steps.at(-1)!.effects.length > 0 && <span className="font-mono text-[11px] text-slate-500">{r.steps.at(-1)!.effects.join(", ")}</span>}
          </div>
          {!r.pass && (
            <ul className="mt-1 list-disc pl-10 text-xs text-red-800">
              {r.failures.map((f, j) => (
                <li key={j}>{f}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function PolicyDetail({ detail, guardEnglish, canEdit, llmMode }: { detail: Detail; guardEnglish: Record<string, string>; canEdit: boolean; llmMode: string }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(detail.status === "COMPILE_FAILED" ? "validation" : detail.status === "VALIDATED" ? "validation" : "clauses");

  const validation = detail.validation;
  const blocking = validation?.issues.filter((i) => i.severity === "blocking") ?? [];
  const warnings = validation?.issues.filter((i) => i.severity === "warning") ?? [];
  const clauses = detail.inventory?.clauses ?? [];
  const rules = detail.rulesDoc?.rules ?? [];
  const unsupported = detail.rulesDoc?.unsupported_clauses ?? [];
  const unsupportedIds = new Set(unsupported.map((u) => u.clause_id));
  const compiling = detail.status === "COMPILING";
  const hashPrefix = detail.bundleHash?.slice(0, 6) ?? "";
  const canApprove = canEdit && detail.status === "VALIDATED" && Boolean(detail.bundleHash);

  async function call(path: string, body: unknown, success: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { body });
      toast.success(success);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StateChip state={detail.status} className="h-6 px-2.5 text-xs" data-testid="policy-status" />
        {detail.status !== "DRAFT" && (
          <Chip tone={detail.compileSource === "manual" ? "amber" : "indigo"} data-testid="compile-source">
            {detail.compileSource === "manual" ? <Wrench className="size-3" /> : <Sparkles className="size-3" />}
            {detail.compileSource === "manual" ? "manual fallback (hand-written monitors)" : "AI-compiled"}
          </Chip>
        )}
        {detail.bundleHash && <span className="font-mono text-xs text-slate-500">bundle {shortHash(detail.bundleHash, 12)}</span>}
        {detail.activatedAt && <span className="text-xs text-slate-500">active since {formatDateTime(detail.activatedAt)}</span>}
        <div className="ml-auto flex items-center gap-2">
          {canEdit && (detail.status === "DRAFT" || detail.status === "COMPILE_FAILED" || detail.status === "VALIDATED") && (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => call(`/api/policies/${detail.id}/use-manual`, {}, "Loaded the hand-written fallback through the same validator.")} title="Loads fixtures/policy/manual-monitors-v1.json. Labeled as manual everywhere." data-testid="use-manual">
                <Wrench /> Use manual fallback
              </Button>
              <Button size="sm" variant={detail.status === "DRAFT" ? "default" : "outline"} disabled={busy} onClick={() => call(`/api/policies/${detail.id}/compile`, {}, "Compile started.")} data-testid="compile">
                <Sparkles /> {detail.status === "DRAFT" ? "Compile" : "Recompile"}
              </Button>
            </>
          )}
        </div>
      </div>

      {compiling && detail.compileJobId && <JobProgress jobId={detail.compileJobId} label="Compiling the policy" stages={["Pass A", "Pass B", "Assembling monitors", "Validating", "Scenario tests", "Done"]} onFinished={refresh} />}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert" data-testid="policy-error">
          {error}
        </p>
      )}

      {detail.status === "COMPILE_FAILED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3" data-testid="compile-failed-banner">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-900">
            <AlertTriangle className="size-4" /> This version cannot become active: {plural(blocking.length, "blocking issue")}.
          </div>
          <ul className="mt-2 space-y-1 text-sm text-red-900">
            {blocking.slice(0, 6).map((issue, i) => (
              <li key={i} className="flex gap-2" data-testid="blocking-issue" data-code={issue.code}>
                <span className="shrink-0 font-mono text-xs font-semibold">{issue.code}</span>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
          {validation?.compileError && llmMode === "replay" && validation.compileError.code === "LLM_REPLAY_MISS" && <p className="mt-2 text-xs text-red-800">Replay mode serves only recorded model responses. This policy text has no recording; use the manual fallback, or record it with BLINK_LLM_MODE=record.</p>}
        </div>
      )}
      {detail.status === "VALIDATED" && validation && (
        <div className="flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900" data-testid="validated-banner">
          <CheckCircle2 className="size-4" /> Validated. It is not in force until the policy owner approves the bundle hash on the Approve tab.
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="clauses" data-testid="tab-clauses">Clauses</TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">Rules</TabsTrigger>
          <TabsTrigger value="monitors" data-testid="tab-monitors">Monitors</TabsTrigger>
          <TabsTrigger value="validation" data-testid="tab-validation">
            Validation{blocking.length > 0 ? ` (${blocking.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="scenarios" data-testid="tab-scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="preview" data-testid="tab-preview">Preview</TabsTrigger>
          <TabsTrigger value="approve" data-testid="tab-approve">Approve</TabsTrigger>
        </TabsList>

        <TabsContent value="clauses" className="mt-4 grid grid-cols-2 items-start gap-4">
          <Panel title="Source text">
            <div className="space-y-3 text-sm leading-relaxed text-slate-700">
              {detail.source.paragraphs.map((p) => (
                <p key={p.id}>
                  <span className="mr-1.5 font-mono text-xs font-semibold text-slate-500">{p.id}</span>
                  {detail.source.requiredParagraphs.includes(p.id) && <Chip tone="slate" className="mr-1.5 align-middle">must be automated</Chip>}
                  <HighlightedParagraph text={p.text} clauses={clauses.filter((c) => c.paragraph === p.id).map((c) => ({ clause_id: c.clause_id, verbatim: c.verbatim, supported: !unsupportedIds.has(c.clause_id) }))} />
                </p>
              ))}
            </div>
          </Panel>
          <div className="space-y-4">
            <Panel title={`Clause inventory (${clauses.length})`} bodyClassName="p-0">
              {clauses.length === 0 ? (
                <p className="p-4 text-sm text-slate-500">Not compiled yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {clauses.map((c) => (
                    <li key={c.clause_id} className="px-4 py-2" data-testid={`clause-${c.clause_id}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-900">{c.clause_id}</span>
                        <span className="font-mono text-xs text-slate-400">{c.paragraph}</span>
                        <Chip tone="slate">{humanize(c.kind).toLowerCase()}</Chip>
                        {unsupportedIds.has(c.clause_id) && (
                          <Chip tone="amber" data-testid={`unsupported-${c.paragraph}`}>
                            <UserRound className="size-3" /> not automated
                          </Chip>
                        )}
                      </div>
                      <p className="mt-1 text-slate-700">{c.plain_meaning}</p>
                      {c.ambiguity && <p className="mt-0.5 text-xs text-amber-700">Ambiguity: {c.ambiguity}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {unsupported.length > 0 && (
              <Panel title="Not automated — a reviewer must apply these manually" className="border-amber-200" bodyClassName="p-0">
                <ul className="divide-y divide-amber-100 text-sm" data-testid="unsupported-list">
                  {unsupported.map((u) => {
                    const clause = clauses.find((c) => c.clause_id === u.clause_id);
                    return (
                      <li key={u.clause_id} className="px-4 py-2">
                        <span className="font-mono text-xs font-semibold text-slate-900">{u.clause_id}</span> <span className="font-mono text-xs text-slate-400">{clause?.paragraph}</span>
                        <p className="text-slate-700">{u.reason}</p>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}
          </div>
        </TabsContent>

        <TabsContent value="rules" className="mt-4 space-y-3">
          {rules.length === 0 && <p className="text-sm text-slate-500">No rules yet.</p>}
          {rules.map((rule) => (
            <Panel
              key={rule.rule_id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{rule.rule_id}</span> {rule.intent}
                </span>
              }
              action={<Chip tone={rule.severity === "high" ? "red" : rule.severity === "medium" ? "amber" : "slate"}>{rule.severity}</Chip>}
            >
              <blockquote className="rounded-r-md border-l-4 border-indigo-300 bg-indigo-50/60 px-3 py-2 text-sm text-slate-800" data-testid={`guard-${rule.rule_id}`}>
                {guardEnglish[rule.rule_id] ?? "(malformed guard)"}
              </blockquote>
              <dl className="mt-3 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">When true</dt>
                <dd className="text-slate-800">{ON_TRUE[rule.on_true]}</dd>
                <dt className="text-slate-500">When evidence is missing</dt>
                <dd className="text-slate-800">{ON_INDETERMINATE[rule.on_indeterminate]}</dd>
                <dt className="text-slate-500">Source clauses</dt>
                <dd className="font-mono text-xs text-slate-700">{rule.source_clause_ids.join(", ") || "—"}</dd>
                {rule.exception_clause_ids.length > 0 && (
                  <>
                    <dt className="text-slate-500">Exceptions in the guard</dt>
                    <dd className="font-mono text-xs text-slate-700">{rule.exception_clause_ids.join(", ")}</dd>
                  </>
                )}
                <dt className="text-slate-500">Predicates</dt>
                <dd className="font-mono text-xs text-slate-700">
                  {rule.guard.nodes
                    .filter((n) => n.op === "pred")
                    .map((n) => `${n.name}${n.params && Object.keys(n.params).length > 0 ? `(${Object.entries(n.params).map(([k, v]) => `${k}=${v}`).join(",")})` : ""}`)
                    .join(" · ")}
                </dd>
              </dl>
            </Panel>
          ))}
        </TabsContent>

        <TabsContent value="monitors" className="mt-4 space-y-4">
          {detail.monitors.length === 0 && <p className="text-sm text-slate-500">No monitors yet.</p>}
          {detail.monitors.map((m) => (
            <Panel key={m.monitor_id} title={<span className="font-mono">Monitor {m.monitor_id} · rule {m.rule_id}</span>}>
              <MonitorGraph monitor={m} />
              <div className="mt-3 overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      {["#", "From", "Event", "Guard is", "To", "Effects"].map((h) => (
                        <th key={h} className="px-2 py-1.5 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-mono text-[11px] text-slate-700">
                    {m.transitions.map((t) => (
                      <tr key={t.id} className="border-t border-slate-100">
                        <td className="px-2 py-1">{t.id}</td>
                        <td className="px-2 py-1">{t.from.join(", ")}</td>
                        <td className="px-2 py-1">{t.event}</td>
                        <td className="px-2 py-1">{t.result_is}</td>
                        <td className="px-2 py-1">{t.to}</td>
                        <td className="px-2 py-1">{t.effects.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-slate-500">States describe evidence only. No transition leaves REVIEW_REQUIRED: once review is required, only a person can close it. Any other event leaves the state unchanged and is audited.</p>
            </Panel>
          ))}
        </TabsContent>

        <TabsContent value="validation" className="mt-4 space-y-4">
          {!validation ? (
            <p className="text-sm text-slate-500">Not compiled yet.</p>
          ) : (
            <>
              <div className={cn("rounded-xl border px-4 py-3 text-sm", validation.totals.deterministic && validation.totals.indeterminate_handled ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")} data-testid="enumeration-summary">
                <span className="font-semibold">{formatCount(validation.totals.combinations)} evidence combinations</span> checked across {plural(validation.totals.monitors, "monitor")}: {validation.totals.deterministic ? "deterministic" : "NOT deterministic"}, {validation.totals.indeterminate_handled ? "indeterminate always handled" : "indeterminate NOT always handled"}.
                <span className="ml-1 text-xs opacity-80">Every assignment of supported / refuted / unknown / conflict to each rule&apos;s predicates was enumerated.</span>
              </div>

              <Panel title={`Issues (${blocking.length} blocking, ${warnings.length} warnings)`} bodyClassName="p-0">
                {validation.issues.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">No issues.</p>
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm" data-testid="issues">
                    {[...blocking, ...warnings].map((issue, i) => (
                      <li key={i} className="flex gap-3 px-4 py-2" data-code={issue.code} data-severity={issue.severity}>
                        <Chip tone={issue.severity === "blocking" ? "red" : "amber"} className="mt-0.5 font-mono">
                          {issue.code}
                        </Chip>
                        <span className="text-slate-700">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Exhaustive enumeration, per monitor" bodyClassName="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs text-slate-600">
                    <tr>
                      {["Monitor", "Rule", "Predicates", "Combinations", "True", "False", "Indeterminate", "Deterministic", "Indeterminate handled", "Coverage"].map((h) => (
                        <th key={h} className="px-3 py-1.5 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {validation.enumeration.map((e) => (
                      <tr key={e.monitor_id} className="border-t border-slate-100" data-testid={`enumeration-${e.monitor_id}`}>
                        <td className="px-3 py-1.5 font-mono text-xs">{e.monitor_id}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{e.rule_id}</td>
                        <td className="px-3 py-1.5">{e.predicates.length}</td>
                        <td className="px-3 py-1.5">{formatCount(e.combinations)}</td>
                        <td className="px-3 py-1.5">{e.outcomes.true}</td>
                        <td className="px-3 py-1.5">{e.outcomes.false}</td>
                        <td className="px-3 py-1.5">{e.outcomes.indeterminate}</td>
                        <td className={cn("px-3 py-1.5", e.determinism.pass ? "text-emerald-700" : "font-semibold text-red-700")}>{e.determinism.pass ? "yes" : "NO"}</td>
                        <td className={cn("px-3 py-1.5", e.indeterminate_handled ? "text-emerald-700" : "font-semibold text-red-700")}>{e.indeterminate_handled ? "yes" : "NO"}</td>
                        <td className="px-3 py-1.5">
                          {e.coverage.handled}/{e.coverage.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </>
          )}

          <Panel title="Compile attempts" bodyClassName="p-0">
            {detail.attempts.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">None yet.</p>
            ) : (
              <ol className="divide-y divide-slate-100 text-sm" data-testid="attempts">
                {detail.attempts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <span className="w-56 text-slate-800">
                      {STAGE_LABEL[a.stage] ?? a.stage} <span className="text-slate-400">#{a.attemptNo}</span>
                    </span>
                    {a.issues.length === 0 ? <Chip tone="emerald">no blocking issues</Chip> : <Chip tone="red">{[...new Set(a.issues.map((i) => i.code))].join(", ")}</Chip>}
                    <span className="ml-auto text-xs text-slate-400">{formatDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="scenarios" className="mt-4 grid grid-cols-2 items-start gap-4">
          <Panel
            title={
              <span className="flex items-center gap-2">
                Reviewer-authored
                {detail.scenarios?.reviewer && (
                  <Chip tone={detail.scenarios.reviewer.failed === 0 ? "emerald" : "red"} data-testid="reviewer-scenarios">
                    {detail.scenarios.reviewer.passed}/{detail.scenarios.reviewer.total} pass
                  </Chip>
                )}
              </span>
            }
          >
            <p className="mb-3 text-xs text-slate-600">Written by a person before any model tuning. Each is run through the real monitor reducer. A mismatch blocks activation.</p>
            {detail.scenarios?.reviewer ? <ScenarioList report={detail.scenarios.reviewer} /> : <p className="text-sm text-slate-500">{detail.source.hasReviewerScenarios ? "Not run: the compile did not get as far as scenarios." : "This policy has no reviewer-authored scenarios."}</p>}
          </Panel>
          <Panel
            title={
              <span className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-indigo-500" /> AI-proposed
                {detail.scenarios?.ai && (
                  <Chip tone={detail.scenarios.ai.failed === 0 ? "slate" : "amber"}>
                    {detail.scenarios.ai.failed === 0 ? `${detail.scenarios.ai.total} agree` : `${plural(detail.scenarios.ai.failed, "disagreement")} of ${detail.scenarios.ai.total}`}
                  </Chip>
                )}
              </span>
            }
          >
            <p className="mb-3 text-xs text-slate-600">A model that was not shown the monitors states what should happen; code runs each case. Disagreements are warnings for the owner to inspect. They never block, and agreement is not proof.</p>
            {detail.scenarios?.ai ? <ScenarioList report={detail.scenarios.ai} /> : <p className="text-sm text-slate-500">Not run.</p>}
          </Panel>
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          <Panel title="Deterministic preview (generated by code, no model)">{detail.previewMd ? <MarkdownLite source={detail.previewMd} /> : <p className="text-sm text-slate-500">Available once the policy compiles to well-formed rules and monitors.</p>}</Panel>
        </TabsContent>

        <TabsContent value="approve" className="mt-4">
          <Panel title="Approve and activate" className="max-w-2xl">
            {detail.status === "ACTIVE" ? (
              <p className="flex items-center gap-2 text-sm text-emerald-800" data-testid="active-note">
                <CheckCircle2 className="size-4" /> ACTIVE. Approved{detail.approvedAt ? ` on ${formatDateTime(detail.approvedAt)}` : ""}. This version is immutable; to change the policy, create a new version.
              </p>
            ) : detail.status === "SUPERSEDED" ? (
              <p className="text-sm text-slate-600">Superseded by a newer version{detail.supersededAt ? ` on ${formatDateTime(detail.supersededAt)}` : ""}. Immutable.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-slate-700">Approving states that this exact bundle — source text, clause inventory, rules, monitors, validation report, and scenario report — is the firm&apos;s policy. Cases are then re-evaluated under it, and decisions made under the previous version reopen.</p>
                <div>
                  <div className="text-xs font-medium text-slate-500">Bundle hash (SHA-256)</div>
                  <div className="mt-0.5 rounded-md bg-slate-100 px-2 py-1.5 font-mono text-xs break-all text-slate-800" data-testid="bundle-hash">
                    {detail.bundleHash ?? "— not compiled —"}
                  </div>
                </div>
                {detail.status !== "VALIDATED" && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-red-800" data-testid="approve-disabled-reason">
                    {detail.status === "COMPILE_FAILED" ? `Approval is disabled: this version has ${plural(blocking.length, "blocking issue")}. The server refuses it as well.` : detail.status === "COMPILING" ? "Approval is disabled while the compile is running." : "Approval is disabled: compile the policy first."}
                  </p>
                )}
                {!canEdit && <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-900">Only the policy owner can approve.</p>}
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">To confirm, type the first 6 characters of the bundle hash</span>
                  <Input value={confirm} onChange={(e) => setConfirm(e.target.value.trim())} placeholder={canApprove ? hashPrefix : "------"} className="mt-0.5 w-40 font-mono" maxLength={6} disabled={!canApprove} data-testid="approve-confirm" />
                </label>
                <Button disabled={!canApprove || busy || confirm.toLowerCase() !== hashPrefix.toLowerCase()} onClick={() => call(`/api/policies/${detail.id}/approve`, { bundleHash: detail.bundleHash }, `${detail.label} is now ACTIVE.`)} data-testid="approve-policy">
                  <ShieldCheck /> Approve this hash and activate
                </Button>
              </div>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
