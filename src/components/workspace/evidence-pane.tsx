"use client";

import { ArrowRight, Flag, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Chip, StateChip } from "@/components/app/status-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { OUTCOME_LABEL, formatDateTime, humanize, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView, FindingView, WorkspacePayload } from "@/server/services/workspace";
import { ClaimFieldsEditor } from "./claim-fields";
import { ContextTasks, FindingActions } from "./finding-actions";
import { QUOTE_ROLE_LABEL, type Selection, scrollToTurn, userName } from "./model";
import { PublicEvidence } from "./public-evidence";
import { RuleTraces } from "./trace";

function Section({ title, children, testId, hint }: { title: string; children: React.ReactNode; testId?: string; hint?: string }) {
  return (
    <section className="border-t px-4 py-3" data-testid={testId}>
      <h3 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {title}
        {hint && <span className="font-normal tracking-normal text-slate-400 normal-case">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

function LinkedPassages({ claim }: { claim: ClaimView }) {
  return (
    <div className="space-y-1.5">
      {claim.quotes.map((q) => (
        <button key={q.id} type="button" onClick={() => scrollToTurn(q.turnLabel)} className="group flex w-full gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-slate-100" data-testid={`quote-${q.turnLabel}`} title="Scroll the transcript to this turn">
          <span className="w-8 shrink-0 font-mono text-xs font-semibold text-indigo-700">{q.turnLabel}</span>
          <span className="min-w-0 flex-1 text-slate-800">“{q.quote}”</span>
          <span className="shrink-0 text-xs text-slate-400">({QUOTE_ROLE_LABEL[q.role] ?? q.role})</span>
        </button>
      ))}
      {claim.correctedBy.length > 0 && <p className="text-xs text-slate-500">The expert later corrected this statement: see {claim.correctedBy.join(", ")}.</p>}
      {claim.fields.is_correction_of && <p className="text-xs text-slate-500">This statement corrects {claim.fields.is_correction_of}.</p>}
    </div>
  );
}

/** The mini FSM path: where the claim's monitors stood after each turn (§15.2). */
function PathChips({ path }: { path: FindingView["path"] }) {
  if (path.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1" data-testid="fsm-path">
      {path.map((step, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          {i > 0 && <ArrowRight className="size-3 text-slate-300" />}
          <StateChip state={step.state} />
          {step.turnLabel && <span className="font-mono text-[11px] text-slate-500">at {step.turnLabel}</span>}
        </span>
      ))}
    </div>
  );
}

function Decisions({ finding, payload }: { finding: FindingView; payload: WorkspacePayload }) {
  if (finding.decisions.length === 0) return null;
  return (
    <div className="space-y-2">
      {finding.decisions.map((d) => (
        <div key={d.id} className={cn("rounded-lg border px-3 py-2 text-sm", d.stale ? "border-red-200 bg-red-50" : "bg-slate-50")} data-testid="decision" data-stale={d.stale}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900">{d.kind === "escalation_request" ? "Escalation requested" : (OUTCOME_LABEL[d.outcome ?? ""] ?? d.outcome)}</span>
            {d.kind === "escalation_decision" && <Chip tone="violet">senior decision</Chip>}
            {d.stale && <Chip tone="red">stale</Chip>}
            <span className="ml-auto text-xs text-slate-500">
              {userName(payload, d.actorId)} · {formatDateTime(d.createdAt)}
            </span>
          </div>
          <p className="mt-1 text-slate-700">{d.rationale}</p>
          {d.stale && d.staleReason && <p className="mt-1 text-xs font-medium text-red-700">Stale: {d.staleReason}. The finding was reopened.</p>}
          {d.evidence.length > 0 && (
            <details className="mt-1.5 text-xs text-slate-500">
              <summary className="cursor-pointer">
                Based on {d.evidence.length} pinned source{d.evidence.length === 1 ? "" : "s"} · evidence hash <span className="font-mono">{shortHash(d.evidenceHash)}</span>
              </summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {d.evidence.map((e, i) => (
                  <li key={i}>
                    {humanize(e.sourceType)}: {e.sourceLabel} <span className="font-mono text-slate-400">{shortHash(e.sourceHash, 8)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

const HISTORY_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  FINDING_CREATED: (p) => `Opened in ${p.state ?? "review"}${p.at_turn ? ` at ${p.at_turn}` : ""}`,
  FINDING_STATE_CHANGED: (p) => `${p.from} → ${p.to}${p.cause ? ` (${p.cause})` : ""}`,
  FINDING_ESCALATED: () => "Escalated to a senior compliance officer",
  FINDING_DISPOSITIONED: (p) => `Dispositioned: ${OUTCOME_LABEL[String(p.outcome)] ?? p.outcome}`,
  TASK_OPENED: (p) => `Task opened (${p.kind})`,
  TASK_CLOSED: (p) => `Task ${p.status === "cancelled" ? "cancelled" : "closed"} (${p.kind})${p.reason ? `: ${p.reason}` : ""}`,
  CLARIFICATION_ANSWERED: () => "Clarification answered",
};

function History({ finding, payload }: { finding: FindingView; payload: WorkspacePayload }) {
  return (
    <ol className="space-y-1 text-xs text-slate-600">
      {finding.history.map((e) => (
        <li key={e.seq} className="flex gap-2">
          <span className="w-8 shrink-0 text-right font-mono text-slate-400">#{e.seq}</span>
          <span className="min-w-0 flex-1">{HISTORY_TEXT[e.type]?.(e.payload) ?? humanize(e.type)}</span>
          <span className="shrink-0 text-slate-400">{userName(payload, e.actorId)}</span>
        </li>
      ))}
    </ol>
  );
}

function RaiseFinding({ payload, claim, onCreated }: { payload: WorkspacePayload; claim: ClaimView; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    try {
      const res = await api<{ findingId: string; label: string }>("/api/findings", { body: { caseId: payload.case.id, title, severity: "medium", explanation: why, claimLogicalKey: claim.logicalKey, turnLabel: claim.turnLabels[0] ?? null } });
      toast.success(`${res.label} raised.`);
      setOpen(false);
      onCreated(res.findingId);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <Button size="xs" variant="outline" onClick={() => setOpen(true)} data-testid="raise-finding">
        <Flag /> Raise a finding on this statement
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title" className="h-8 text-sm" />
      <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why are you raising this?" className="h-8 text-sm" />
      <div className="flex justify-end gap-2">
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button size="xs" disabled={busy || title.trim().length < 3 || !why.trim()} onClick={create}>
          Raise finding
        </Button>
      </div>
    </div>
  );
}

export function EvidencePane({ payload, selection, onSelect, refresh, focus }: { payload: WorkspacePayload; selection: Selection; onSelect: (s: Selection) => void; refresh: () => void; focus: "escalate" | "dispose" | null }) {
  const finding = selection?.kind === "finding" ? (payload.findings.find((f) => f.id === selection.id) ?? null) : null;
  const claimKey = finding ? finding.claimLogicalKey : selection?.kind === "claim" ? selection.key : null;
  const claim = claimKey ? (payload.claims.find((c) => c.logicalKey === claimKey) ?? null) : null;

  if (!finding && !claim) {
    return <div className="p-6 text-sm text-slate-500">Select a finding, or click a highlighted passage in the transcript, to see the evidence behind it.</div>;
  }

  return (
    <div className="text-sm" data-testid="evidence-pane">
      <div className="px-4 py-3">
        {finding ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-semibold text-slate-900" data-testid="evidence-label">
                {finding.label}
              </span>
              <StateChip state={finding.state} data-testid="evidence-state" />
              <span className="text-xs font-medium text-slate-500 capitalize">{finding.severity} severity</span>
              {finding.origin === "ai_suggested" && (
                <Chip tone="indigo">
                  <Sparkles className="size-3" /> AI suggestion
                </Chip>
              )}
              {finding.origin === "reviewer" && <Chip tone="slate">raised by a reviewer</Chip>}
            </div>
            <h2 className="mt-1.5 text-base font-semibold text-slate-900">{finding.title}</h2>
            <p className="mt-1 text-slate-700">{finding.explanation}</p>
            {finding.origin === "ai_suggested" && <p className="mt-1 text-xs text-slate-500">Raised by the extraction model, not by a policy rule. It can open review work; only a reviewer can close it.</p>}
            {finding.path.length > 1 && (
              <div className="mt-2.5">
                <PathChips path={finding.path} />
              </div>
            )}
          </>
        ) : (
          claim && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-slate-900">{claim.logicalKey}</span>
                <Chip tone="slate">no finding</Chip>
                {claim.eligibility.eligible ? <Chip tone="emerald">eligible for the brief</Chip> : claim.eligibility.detail && <Chip tone="amber">{claim.eligibility.detail}</Chip>}
              </div>
              <p className="mt-1.5 text-slate-800">{claim.fields.summary}</p>
            </>
          )
        )}
      </div>

      {claim && (
        <Section title="Linked passages" testId="linked-passages" hint="exact quotes, checked against the transcript">
          <LinkedPassages claim={claim} />
          {finding && claim.logicalKey && <p className="mt-1.5 text-xs text-slate-400">{claim.logicalKey}: {claim.fields.summary}</p>}
        </Section>
      )}

      {finding && finding.origin !== "ai_suggested" && claim && (
        <Section title="Why (trace)" testId="trace" hint="each rule's guard, as code evaluated it">
          <RuleTraces claim={claim} payload={payload} />
        </Section>
      )}
      {!finding && claim && claim.monitors.length > 0 && (
        <Section title="Policy evaluation" testId="trace">
          <RuleTraces claim={claim} payload={payload} />
        </Section>
      )}

      {finding && (finding.state !== "DISPOSITIONED" || finding.tasks.some((t) => t.answer)) && finding.origin !== "ai_suggested" && (
        <Section title="Missing context">
          <ContextTasks finding={finding} claim={claim} refresh={refresh} />
        </Section>
      )}

      {claim && (
        <Section title="Public evidence">
          <PublicEvidence claim={claim} refresh={refresh} />
        </Section>
      )}

      {claim && (
        <Section title="Claim fields">
          <ClaimFieldsEditor key={claim.id} claim={claim} refresh={refresh} />
        </Section>
      )}

      {finding ? (
        <>
          {finding.state !== "DISPOSITIONED" && (
            <Section title="Actions" testId="actions">
              <FindingActions key={`${finding.id}:${finding.version}:${focus ?? ""}`} finding={finding} payload={payload} refresh={refresh} focus={focus} />
            </Section>
          )}
          {finding.decisions.length > 0 && (
            <Section title="Decisions" testId="decisions">
              <Decisions finding={finding} payload={payload} />
            </Section>
          )}
          <Section title="History" testId="history">
            <History finding={finding} payload={payload} />
          </Section>
        </>
      ) : (
        claim && (
          <Section title="Actions">
            <RaiseFinding payload={payload} claim={claim} onCreated={(id) => (onSelect({ kind: "finding", id }), refresh())} />
          </Section>
        )
      )}
    </div>
  );
}
