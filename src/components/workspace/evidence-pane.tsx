"use client";

import { Flag, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { StateChip } from "@/components/app/status-chip";
import { StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { HIDDEN_STATUS_LABEL, OUTCOME_LABEL, formatDateTime, humanize, shortHash } from "@/lib/format";
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
      <h3 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-xs font-medium text-foreground">
        <span className="whitespace-nowrap">{title}</span>
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** The words a live finding hid, on the current transcript, in place of a claim's linked quotes. */
function LivePassages({ finding }: { finding: FindingView }) {
  if (finding.passages.length === 0) return <p className="text-sm text-muted-foreground">No passage was recorded for this finding.</p>;
  return (
    <div className="space-y-1.5">
      {finding.passages.map((p, i) => (
        <button key={`${p.turnLabel}:${i}`} type="button" onClick={() => scrollToTurn(p.turnLabel)} className="flex w-full gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted" data-testid={`quote-${p.turnLabel}`} title="Scroll the transcript to this turn">
          <span className="w-8 shrink-0 font-mono text-xs font-medium text-foreground">{p.turnLabel}</span>
          <span className="min-w-0 flex-1 text-foreground">“{p.text}”</span>
        </button>
      ))}
    </div>
  );
}

function LinkedPassages({ claim }: { claim: ClaimView }) {
  return (
    <div className="space-y-1.5">
      {claim.quotes.map((q) => (
        <button key={q.id} type="button" onClick={() => scrollToTurn(q.turnLabel)} className="group flex w-full gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-muted" data-testid={`quote-${q.turnLabel}`} title="Scroll the transcript to this turn">
          <span className="w-8 shrink-0 font-mono text-xs font-medium text-foreground">{q.turnLabel}</span>
          <span className="min-w-0 flex-1 text-foreground">
            “{q.quote}”
            {q.normalized && (
              <span className="ml-1 text-xs text-muted-foreground" title="Matched after normalizing whitespace, quote marks, or dashes. The offsets point at the original text.">
                ≈
              </span>
            )}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">({QUOTE_ROLE_LABEL[q.role] ?? q.role})</span>
        </button>
      ))}
      {claim.correctedBy.length > 0 && <p className="text-xs text-muted-foreground">The expert later corrected this statement: see {claim.correctedBy.join(", ")}.</p>}
      {claim.fields.is_correction_of && <p className="text-xs text-muted-foreground">This statement corrects {claim.fields.is_correction_of}.</p>}
    </div>
  );
}

/** Where the claim's monitors stood after each turn, read as one line: "Unassessed → Needs context at T5 → Review required at T11" (§15.2). */
function StatePath({ path }: { path: FindingView["path"] }) {
  if (path.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs" data-testid="fsm-path">
      {path.map((step, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true" className="text-muted-foreground">→</span>}
          <StateChip state={step.state} />
          {step.turnLabel && <span className="text-muted-foreground">at {step.turnLabel}</span>}
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
        <div key={d.id} className={cn("rounded-lg border px-3 py-2 text-sm", d.stale ? "border-destructive/40 bg-destructive/10" : "bg-muted")} data-testid="decision" data-stale={d.stale}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{d.kind === "escalation_request" ? "Escalation requested" : (OUTCOME_LABEL[d.outcome ?? ""] ?? d.outcome)}</span>
            {d.kind === "escalation_decision" && <span className="text-xs text-muted-foreground">senior decision</span>}
            {d.stale && <StatusDot tone="stop" className="text-xs">stale</StatusDot>}
            <span className="ml-auto text-xs text-muted-foreground">
              {userName(payload, d.actorId)} · {formatDateTime(d.createdAt)}
            </span>
          </div>
          <p className="mt-1 text-foreground">{d.rationale}</p>
          {d.stale && d.staleReason && <p className="mt-1 text-xs font-medium text-foreground">Stale: {d.staleReason}. The finding was reopened.</p>}
          {d.evidence.length > 0 && (
            <details className="mt-1.5 text-xs text-muted-foreground">
              <summary className="cursor-pointer" data-testid="decision-evidence">
                Decided on evidence <span className="font-mono">#{shortHash(d.evidenceHash, 8)}</span> · {d.evidence.length} pinned source{d.evidence.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {d.evidence.map((e, i) => (
                  <li key={i}>
                    {humanize(e.sourceType)}: {e.sourceLabel} <span className="font-mono text-muted-foreground">{shortHash(e.sourceHash, 8)}</span>
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
  FINDING_STATE_CHANGED: (p) => `${humanize(String(p.from))} → ${humanize(String(p.to))}${p.cause ? ` (${p.cause})` : ""}`,
  FINDING_ESCALATED: () => "Escalated to a senior compliance officer",
  FINDING_DISPOSITIONED: (p) => `Dispositioned: ${OUTCOME_LABEL[String(p.outcome)] ?? p.outcome}`,
  TASK_OPENED: (p) => `Task opened (${p.kind})`,
  TASK_CLOSED: (p) => `Task ${p.status === "cancelled" ? "cancelled" : "closed"} (${p.kind})${p.reason ? `: ${p.reason}` : ""}`,
  CLARIFICATION_ANSWERED: () => "Clarification answered",
};

function History({ finding, payload }: { finding: FindingView; payload: WorkspacePayload }) {
  return (
    <ol className="space-y-1 text-xs text-muted-foreground">
      {finding.history.map((e) => (
        <li key={e.seq} className="flex gap-2">
          <span className="w-8 shrink-0 text-right font-mono">#{e.seq}</span>
          <span className="min-w-0 flex-1">{HISTORY_TEXT[e.type]?.(e.payload) ?? humanize(e.type)}</span>
          <span className="shrink-0">{userName(payload, e.actorId)}</span>
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
    return <div className="p-6 text-sm text-muted-foreground">Select a finding, or click a highlighted passage in the transcript, to see the evidence behind it.</div>;
  }

  return (
    <div className="text-sm" data-testid="evidence-pane">
      <div className="px-4 py-3">
        {finding ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium text-foreground" data-testid="evidence-label">
                {finding.label}
              </span>
              <StateChip state={finding.state} data-testid="evidence-state" />
              <span className="text-xs text-muted-foreground">{finding.severity} severity</span>
              {finding.origin === "ai_suggested" && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Sparkles className="size-3" /> AI suggestion
                </span>
              )}
              {finding.origin === "reviewer" && <span className="text-xs text-muted-foreground">raised by a reviewer</span>}
            </div>
            <h2 className="mt-1.5 text-base font-semibold text-foreground">{finding.title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground" data-testid="hidden-status">
              {HIDDEN_STATUS_LABEL[finding.hidden]}
            </p>
            <p className="mt-1 text-foreground">{finding.explanation}</p>
            {finding.origin === "ai_suggested" && <p className="mt-1 text-xs text-muted-foreground">Raised by the extraction model, not by a policy rule. It can open review work; only a reviewer can close it.</p>}
            {finding.path.length > 1 && (
              <div className="mt-2.5">
                <StatePath path={finding.path} />
              </div>
            )}
          </>
        ) : (
          claim && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium text-foreground">{claim.logicalKey}</span>
                <span className="text-xs text-muted-foreground">no finding</span>
                {claim.eligibility.eligible ? <StatusDot tone="good" className="text-xs">eligible for the brief</StatusDot> : claim.eligibility.detail && <StatusDot tone="warn" className="text-xs">{claim.eligibility.detail}</StatusDot>}
              </div>
              <p className="mt-1.5 text-foreground">{claim.fields.summary}</p>
            </>
          )
        )}
      </div>

      {finding?.origin === "live" && (
        <Section title="Hidden passages" testId="live-passages" hint="what was said, as it stands on the current transcript">
          <LivePassages finding={finding} />
        </Section>
      )}

      {claim && (
        <Section title="Linked passages" testId="linked-passages" hint="exact quotes, checked against the transcript">
          <LinkedPassages claim={claim} />
          {finding && claim.logicalKey && <p className="mt-1.5 text-xs text-muted-foreground">{claim.logicalKey}: {claim.fields.summary}</p>}
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
          <ContextTasks finding={finding} claim={claim} issuer={payload.case.issuer} refresh={refresh} />
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
