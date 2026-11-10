"use client";

import { ArrowUpRight, HelpCircle, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ACCESS_TIMINGS, KNOWLEDGE_BASES } from "@/core/types";
import { api, errorMessage } from "@/lib/api";
import { OUTCOME_LABEL, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ClaimView, FindingView, WorkspacePayload } from "@/server/services/workspace";

type Task = FindingView["tasks"][number];

const selectClass = "h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs";

/** Open questions on a finding, with the form that records an answer and maps it onto claim fields (§10.6). */
export function ContextTasks({ finding, claim, issuer, refresh }: { finding: FindingView; claim: ClaimView | null; issuer: string; refresh: () => void }) {
  const open = finding.tasks.filter((t) => (t.kind === "context" || t.kind === "clarification") && t.status === "open");
  const answered = finding.tasks.filter((t) => (t.kind === "context" || t.kind === "clarification") && t.status === "done" && t.answer);
  const [adding, setAdding] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  async function addQuestion() {
    setBusy(true);
    try {
      await api(`/api/findings/${finding.id}/tasks`, { body: { question } });
      setQuestion("");
      setAdding(false);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const aiQuestions = claim?.meta.aiQuestions ?? [];
  if (open.length === 0 && answered.length === 0 && finding.missingContext.length === 0 && finding.state === "DISPOSITIONED") return null;

  return (
    <div className="space-y-2" data-testid="missing-context">
      {finding.missingContext.length > 0 && open.length > 0 && (
        <ul className="space-y-1 text-sm">
          {finding.missingContext.map((m, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-xs text-muted-foreground">{m.ruleId}</span>
              <span className="text-foreground">{m.explanation || m.question}</span>
            </li>
          ))}
        </ul>
      )}
      {open.map((task) => (
        <AnswerForm key={task.id} task={task} claim={claim} issuer={issuer} aiQuestions={aiQuestions} refresh={refresh} />
      ))}
      {answered.map((task) => (
        <div key={task.id} className="rounded-lg border bg-muted px-3 py-2 text-xs">
          <div className="text-muted-foreground">{task.question}</div>
          <div className="mt-1 text-foreground">Answer: {task.answer}</div>
        </div>
      ))}
      {finding.state !== "DISPOSITIONED" &&
        (adding ? (
          <div className="space-y-2">
            <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Your question for the analyst or the expert" className="h-16 text-sm" />
            <div className="flex justify-end gap-2">
              <Button size="xs" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button size="xs" disabled={busy || question.trim().length < 5} onClick={addQuestion}>
                Add question
              </Button>
            </div>
          </div>
        ) : (
          <Button size="xs" variant="outline" onClick={() => setAdding(true)} data-testid="add-clarification">
            <HelpCircle /> Clarify: add a question
          </Button>
        ))}
    </div>
  );
}

function AnswerForm({ task, claim, issuer, aiQuestions, refresh }: { task: Task; claim: ClaimView | null; issuer: string; aiQuestions: string[]; refresh: () => void }) {
  const [answer, setAnswer] = useState("");
  const [basis, setBasis] = useState("");
  const [timing, setTiming] = useState("");
  const [company, setCompany] = useState("");
  const [period, setPeriod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const fieldMapping: Record<string, unknown> = {};
    if (basis) fieldMapping.knowledge_basis = basis;
    if (timing) fieldMapping.access_timing = timing;
    if (company && claim) fieldMapping.subject_entity = { kind: company, name: company === "issuer" ? issuer : company === "industry" ? null : claim.fields.subject_entity.name };
    if (period && claim) fieldMapping.period = { ...claim.fields.period, relative: period };
    try {
      await api(`/api/tasks/${task.id}/answer`, { body: { answer, fieldMapping, expectedVersion: task.version } });
      toast.success("Clarification recorded. The monitors were re-run on the new context.");
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-warning/40 bg-warning/10 p-3" data-testid="context-task">
      <div className="text-sm font-medium text-foreground">{task.question}</div>
      {aiQuestions.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {aiQuestions.map((q) => (
            <div key={q} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 size-3 shrink-0" />
              <span>
                <span className="font-medium text-foreground">AI-suggested question:</span> {q}
              </span>
            </div>
          ))}
        </div>
      )}
      <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Record the answer you received from the analyst or the expert" className="mt-2 h-16 bg-background text-sm" data-testid="clarification-answer" />
      {claim && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">
            The answer establishes the source as
            <select value={basis} onChange={(e) => setBasis(e.target.value)} className={cn(selectClass, "mt-0.5")} data-testid="map-knowledge_basis">
              <option value="">no change ({humanize(claim.fields.knowledge_basis)})</option>
              {KNOWLEDGE_BASES.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            …and the access timing as
            <select value={timing} onChange={(e) => setTiming(e.target.value)} className={cn(selectClass, "mt-0.5")} data-testid="map-access_timing">
              <option value="">no change ({humanize(claim.fields.access_timing)})</option>
              {ACCESS_TIMINGS.map((k) => (
                <option key={k} value={k}>
                  {humanize(k)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            …the company as
            <select value={company} onChange={(e) => setCompany(e.target.value)} className={cn(selectClass, "mt-0.5")} data-testid="map-subject_entity">
              <option value="">no change ({claim.fields.subject_entity.name ?? humanize(claim.fields.subject_entity.kind)})</option>
              <option value="issuer">The covered issuer ({issuer})</option>
              <option value="competitor">A competitor</option>
              <option value="customer">A customer</option>
              <option value="industry">The industry as a whole</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            …and the period as
            <select value={period} onChange={(e) => setPeriod(e.target.value)} className={cn(selectClass, "mt-0.5")} data-testid="map-period">
              <option value="">no change ({humanize(claim.fields.period.relative)})</option>
              <option value="current">Current or ongoing period</option>
              <option value="prior">A period that has ended</option>
              <option value="future">A future period</option>
            </select>
          </label>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">The mapped values become reviewer-verified fields. The policy monitors then re-run; their result decides where this finding goes.</p>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={busy || answer.trim().length < 3} onClick={submit} data-testid="submit-clarification">
          {busy ? "Recording…" : "Record answer and re-run monitors"}
        </Button>
      </div>
    </div>
  );
}

const ALL_OUTCOMES = ["cleared_for_research", "restricted_exclude", "restricted_escalate_to_legal", "no_concern"] as const;

/** Promote, escalate, dispose. The server enforces every rule shown here; the hints only explain them. */
export function FindingActions({ finding, payload, refresh, focus }: { finding: FindingView; payload: WorkspacePayload; refresh: () => void; focus: "escalate" | "dispose" | null }) {
  const senior = payload.viewer.role === "senior_reviewer";
  const [mode, setMode] = useState<"dispose" | "escalate" | "promote">(focus === "escalate" ? "escalate" : "dispose");
  const [outcome, setOutcome] = useState<string>(finding.state === "NOT_TRIGGERED_PENDING_ACK" ? "no_concern" : "");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (finding.state === "DISPOSITIONED") return null;

  const needsSenior = finding.state === "ESCALATED" || finding.escalationRequired;
  const canPromote = finding.state === "NEEDS_CONTEXT" || finding.state === "NOT_TRIGGERED_PENDING_ACK";
  const canEscalate = finding.state === "REVIEW_REQUIRED" && !needsSenior;
  const canDispose = finding.state === "REVIEW_REQUIRED" || finding.state === "ESCALATED" || finding.state === "NOT_TRIGGERED_PENDING_ACK";
  const ackOnly = finding.state === "NOT_TRIGGERED_PENDING_ACK";
  const outcomes = ackOnly ? (["no_concern"] as const) : ALL_OUTCOMES;
  const active = mode === "promote" && !canPromote ? "dispose" : mode === "escalate" && !canEscalate ? "dispose" : mode;

  async function send(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/findings/${finding.id}/events`, { body: { ...body, rationale, expectedVersion: finding.version } });
      toast.success(success);
      setRationale("");
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="finding-actions">
      {needsSenior && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted px-3 py-2 text-xs text-foreground" data-testid="escalation-notice">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>{finding.tasks.find((t) => t.kind === "escalation" && t.status === "open")?.question ?? "This finding is escalated."} {senior ? "You can decide it." : "A senior compliance officer must decide it."}</span>
        </div>
      )}
      {finding.state === "NEEDS_CONTEXT" && <p className="text-xs text-muted-foreground">This finding is waiting for context. Answer the question above, or promote it to review if the context cannot be obtained.</p>}
      {ackOnly && <p className="text-xs text-muted-foreground">No rule is triggered on the current evidence. That is not a clearance: acknowledge it as no concern, or promote it to review.</p>}

      <div className="flex gap-1">
        {canDispose && (
          <Button size="xs" variant={active === "dispose" ? "secondary" : "ghost"} onClick={() => setMode("dispose")} data-testid="mode-dispose">
            {ackOnly ? "Acknowledge" : "Dispose"}
          </Button>
        )}
        {canEscalate && (
          <Button size="xs" variant={active === "escalate" ? "secondary" : "ghost"} onClick={() => setMode("escalate")} data-testid="mode-escalate">
            <ArrowUpRight /> Escalate
          </Button>
        )}
        {canPromote && (
          <Button size="xs" variant={active === "promote" ? "secondary" : "ghost"} onClick={() => setMode("promote")} data-testid="mode-promote">
            Promote to review
          </Button>
        )}
      </div>

      {((active === "dispose" && canDispose) || (active === "escalate" && canEscalate) || (active === "promote" && canPromote)) && (
        <div className="space-y-2">
          {active === "dispose" && (
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={cn(selectClass, "h-8 text-sm")} data-testid="outcome-select" id="dispose-outcome">
              {!ackOnly && <option value="">Choose a disposition…</option>}
              {outcomes.map((o) => (
                <option key={o} value={o}>
                  {OUTCOME_LABEL[o]}
                  {o === "restricted_escalate_to_legal" && !senior ? " (senior compliance officer only)" : ""}
                </option>
              ))}
            </select>
          )}
          <Textarea
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder={active === "dispose" ? "Rationale: what you checked and why (at least 20 characters). Stored with the evidence this decision rests on." : active === "escalate" ? "Why does this need a senior compliance officer?" : "Why should this go to review without the missing context?"}
            className="h-20 text-sm"
            data-testid="rationale"
            id="finding-rationale"
          />
          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground" role="alert" data-testid="action-error">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            {active === "dispose" && (
              <Button size="sm" disabled={busy || !outcome || rationale.trim().length === 0} onClick={() => send({ type: "DISPOSE", outcome }, `${finding.label} dispositioned: ${OUTCOME_LABEL[outcome]}.`)} data-testid="submit-dispose">
                {busy ? "Recording…" : ackOnly ? "Acknowledge: no concern" : "Record disposition"}
              </Button>
            )}
            {active === "escalate" && (
              <Button size="sm" disabled={busy || rationale.trim().length === 0} onClick={() => send({ type: "ESCALATE" }, `${finding.label} escalated to a senior compliance officer.`)} data-testid="submit-escalate">
                Escalate
              </Button>
            )}
            {active === "promote" && (
              <Button size="sm" disabled={busy || rationale.trim().length === 0} onClick={() => send({ type: "PROMOTE" }, `${finding.label} promoted to review.`)} data-testid="submit-promote">
                Promote to review
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
