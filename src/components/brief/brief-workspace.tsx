"use client";

import { ArrowLeft, FilePenLine, Plus, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { JobProgress } from "@/components/app/job-progress";
import { Panel } from "@/components/app/page-shell";
import { StateChip } from "@/components/app/status-chip";
import { StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, plural, shortHash } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { briefWorkspace } from "@/server/services/briefs";

type Payload = ReturnType<typeof briefWorkspace>;
type Brief = NonNullable<Payload["brief"]>;
type Section = Brief["sections"][number];
interface Failure {
  code: string;
  message: string;
}

const SOURCE_LABEL: Record<string, string> = { ai: "AI draft", template: "Template draft (no model)", edit: "Edited by a reviewer" };

function CitationChip({ id, active, onClick }: { id: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} data-testid={`citation-${id}`} className={cn("ml-1 inline-flex h-[18px] items-center rounded bg-muted px-1 align-baseline font-mono text-[11px] font-medium text-foreground ring-1 ring-border ring-inset hover:bg-secondary", active && "bg-primary text-primary-foreground ring-primary hover:bg-primary")}>
      {id}
    </button>
  );
}

function BriefBody({ brief, selected, onSelect }: { brief: Brief; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-5" data-testid="brief-body">
      {brief.sections.map((section) => (
        <div key={section.heading}>
          <h3 className="text-sm font-semibold text-foreground">{section.heading}</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm leading-relaxed text-foreground">
            {section.sentences.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/40" />
                <span>
                  {s.text}
                  {s.claim_ids.map((id) => (
                    <CitationChip key={id} id={id} active={selected === id} onClick={() => onSelect(id)} />
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="border-t pt-3 text-sm font-medium text-muted-foreground" data-testid="withheld-note">
        {brief.withheldCount === 0 ? "No statements were withheld by compliance." : `${plural(brief.withheldCount, "statement")} withheld by compliance.`}
      </p>
    </div>
  );
}

function BriefEditor({ brief, eligibleKeys, onSaved, onCancel }: { brief: Brief; eligibleKeys: string[]; onSaved: () => void; onCancel: () => void }) {
  const [sections, setSections] = useState<Section[]>(() => brief.sections.map((s) => ({ heading: s.heading, sentences: s.sentences.map((x) => ({ text: x.text, claim_ids: [...x.claim_ids] })) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (si: number, fn: (s: Section) => Section) => setSections((all) => all.map((s, i) => (i === si ? fn(s) : s)));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/briefs/${brief.id}`, { method: "PATCH", body: { sections: sections.map((s) => ({ heading: s.heading, sentences: s.sentences.filter((x) => x.text.trim()) })).filter((s) => s.sentences.length > 0), expectedVersion: brief.version } });
      toast.success("Saved as a new brief version. Its hash changed, so any earlier approval is void.");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="brief-editor">
      <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
        Every sentence must cite at least one eligible claim. Eligible: <span className="font-mono">{eligibleKeys.join(", ")}</span>. Saving creates a new version with a new hash.
      </p>
      {sections.map((section, si) => (
        <div key={si} className="space-y-2 rounded-lg border p-3">
          <Input value={section.heading} onChange={(e) => update(si, (s) => ({ ...s, heading: e.target.value }))} className="h-8 text-sm font-semibold" />
          {section.sentences.map((sentence, i) => (
            <div key={i} className="flex gap-2">
              <Textarea value={sentence.text} onChange={(e) => update(si, (s) => ({ ...s, sentences: s.sentences.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))} className="min-h-14 flex-1 text-sm" data-testid={`edit-sentence-${si}-${i}`} />
              <Input
                value={sentence.claim_ids.join(", ")}
                onChange={(e) => update(si, (s) => ({ ...s, sentences: s.sentences.map((x, j) => (j === i ? { ...x, claim_ids: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) } : x)) }))}
                className="h-8 w-24 font-mono text-xs"
                aria-label="Cited claims"
              />
              <Button size="icon-sm" variant="ghost" onClick={() => update(si, (s) => ({ ...s, sentences: s.sentences.filter((_, j) => j !== i) }))} aria-label="Remove sentence">
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button size="xs" variant="outline" onClick={() => update(si, (s) => ({ ...s, sentences: [...s.sentences, { text: "", claim_ids: [] }] }))}>
            <Plus /> Sentence
          </Button>
        </div>
      ))}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={save} data-testid="save-brief">
          {busy ? "Saving…" : "Save as new version"}
        </Button>
      </div>
    </div>
  );
}

export function BriefWorkspace({ payload, draftJob, llmMode }: { payload: Payload; draftJob: { id: string; status: string; error: string | null; createdAt: string } | null; llmMode: string }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const { brief, approval } = payload;
  const caseId = payload.case.id;
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [liveJob, setLiveJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [audience, setAudience] = useState<string>(approval && !approval.stale ? approval.audience : "analyst");
  const [approveError, setApproveError] = useState<string | null>(null);
  const [release, setRelease] = useState<{ ok: true; hash: string } | { ok: false; failures: Failure[] } | null>(null);

  const jobId = liveJob ?? (draftJob && (draftJob.status === "queued" || draftJob.status === "running") ? draftJob.id : null);
  // A failed draft is worth showing only until a newer brief exists.
  const draftFailed = !jobId && draftJob?.status === "failed" && (!brief || draftJob.createdAt > brief.createdAt) ? draftJob.error : null;
  const citation = selected ? brief?.citations.find((c) => c.key === selected) : null;
  const eligibleKeys = payload.eligibility.claims.filter((c) => c.eligible).map((c) => c.key);
  const approvedLive = Boolean(brief && brief.status === "approved" && approval && !approval.stale);
  const released = brief?.status === "released";

  async function draft(mode: "ai" | "template") {
    setBusy(true);
    setRelease(null);
    try {
      const res = await api<{ jobId: string | null; briefId: string | null }>(`/api/cases/${caseId}/briefs`, { body: { mode } });
      if (res.jobId) setLiveJob(res.jobId);
      else toast.success("Template draft created.");
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!brief) return;
    setBusy(true);
    setApproveError(null);
    try {
      await api(`/api/briefs/${brief.id}/approve`, { body: { briefHash: brief.contentHash, audience, expectedVersion: brief.version } });
      toast.success(`Brief v${brief.versionNo} approved by hash.`);
      setApproveOpen(false);
      setRelease(null);
      refresh();
    } catch (err) {
      setApproveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function doRelease() {
    if (!brief) return;
    setBusy(true);
    try {
      const res = await api<{ briefHash: string }>(`/api/briefs/${brief.id}/release`, { body: { audience: approval?.audience ?? audience, expectedVersion: brief.version } });
      setRelease({ ok: true, hash: res.briefHash });
      toast.success("Released to the analyst.");
    } catch (err) {
      if (err instanceof ApiError && err.code === "RELEASE_CHECK_FAILED") setRelease({ ok: false, failures: (err.details as { failures: Failure[] }).failures });
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/cases/${caseId}`}>
            <ArrowLeft /> Review workspace
          </Link>
        </Button>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Research brief</h1>
        <span className="text-sm text-muted-foreground">{payload.case.title}</span>
        <StateChip state={payload.case.status} data-testid="case-status" />
      </div>

      <div className="grid grid-cols-[1fr_22rem] items-start gap-4">
        <div className="space-y-4">
          {jobId && (
            <JobProgress
              jobId={jobId}
              label="Drafting the brief from eligible claims"
              stages={["Selecting eligible claims", "Drafting brief", "Checking citations", "Done"]}
              onFinished={() => {
                setLiveJob(null);
                refresh();
              }}
            />
          )}
          {draftFailed && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground" data-testid="draft-failed">
              <p className="font-medium">The AI draft did not complete.</p>
              <p className="mt-1">{draftFailed}</p>
              <p className="mt-1 text-muted-foreground">You can use the template draft instead: one cited sentence per eligible claim, with no model involved.</p>
            </div>
          )}

          {brief ? (
            <Panel
              title={
                <span className="flex flex-wrap items-center gap-2">
                  Brief v{brief.versionNo} <StateChip state={brief.status} data-testid="brief-status" />
                  <span className="text-xs font-normal text-muted-foreground">{SOURCE_LABEL[brief.draftSource] ?? brief.draftSource}</span>
                  {brief.replayed && (
                    <span className="text-xs font-normal text-muted-foreground" title="This draft replayed a recorded model response; no network call was made." data-testid="replayed-badge">
                      Replayed from recorded run · {formatDate(brief.recordedAt)}
                    </span>
                  )}
                  <span className="font-mono text-xs font-normal text-muted-foreground" title={brief.contentHash}>
                    hash {shortHash(brief.contentHash, 12)}
                  </span>
                </span>
              }
              action={
                !editing &&
                !released && (
                  <Button size="xs" variant="outline" onClick={() => setEditing(true)} data-testid="edit-brief">
                    <FilePenLine /> Edit
                  </Button>
                )
              }
            >
              {brief.status === "stale" && (
                <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground" data-testid="brief-stale">
                  <StatusDot tone="stop" className="items-start whitespace-normal [&>span:first-child]:mt-1.5">
                    <span>
                      <span className="font-medium">Stale.</span> {(brief.staleReason ?? "The evidence changed after this brief was approved").replace(/[.\s]+$/, "")}. Redraft or edit it, then approve the new hash.
                    </span>
                  </StatusDot>
                </div>
              )}
              {brief.outdated.length > 0 && brief.status !== "stale" && (
                <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">Cited claims changed after this text was written: {brief.outdated.map((o) => o.label).join("; ")}. Redraft or edit before approving.</div>
              )}
              {brief.dropped.length > 0 && (
                <details className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
                  <summary className="cursor-pointer">{plural(brief.dropped.length, "sentence")} from the draft were dropped by the citation check</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
                    {brief.dropped.map((d, i) => (
                      <li key={i}>
                        “{d.text}” — {d.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {editing ? <BriefEditor brief={brief} eligibleKeys={eligibleKeys} onCancel={() => setEditing(false)} onSaved={() => (setEditing(false), setRelease(null), refresh())} /> : <BriefBody brief={brief} selected={selected} onSelect={(id) => setSelected((cur) => (cur === id ? null : id))} />}
            </Panel>
          ) : (
            !jobId && (
              <Panel title="No brief yet">
                <p className="text-sm text-muted-foreground">A brief is drafted only from claims that are eligible: no open finding, and no restricting disposition. Restricted statements never reach the drafting prompt.</p>
              </Panel>
            )
          )}

          {!editing && !jobId && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant={brief ? "outline" : "default"} disabled={busy} onClick={() => draft("ai")} data-testid="draft-ai">
                <Sparkles /> {brief ? "Redraft with AI" : "Draft with AI"}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => draft("template")} data-testid="draft-template">
                Template draft (no model)
              </Button>
              {llmMode === "replay" && <span className="text-xs text-muted-foreground">Replay mode: the AI draft is served from a recording made for this exact set of eligible claims.</span>}
            </div>
          )}
        </div>

        <div className="space-y-4">
          {citation && (
            <Panel title={`Citation ${citation.key}`} bodyClassName="space-y-2 p-3">
              <p className="text-sm text-foreground">{citation.summary}</p>
              {citation.quotes.map((q, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  <span className="font-mono font-semibold text-foreground">{q.turnLabel}</span> “{q.quote}”
                </p>
              ))}
            </Panel>
          )}

          <Panel title="Approval and release" bodyClassName="space-y-3 p-3">
            {payload.reviewBlockers.length > 0 && (
              <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground" data-testid="brief-blockers">
                <p className="font-medium">The review is not complete, so nothing can be approved yet:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {payload.reviewBlockers.map((b, i) => (
                    <li key={i}>{b.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {approval && (
              <div className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-foreground" data-testid="approval-status" data-stale={approval.stale}>
                <StatusDot tone={approval.stale ? "stop" : "good"} className="items-start whitespace-normal [&>span:first-child]:mt-1">
                  <span>
                    {approval.stale ? (
                      <>
                        <span className="font-medium">Approval STALE:</span> {approval.staleReason}
                      </>
                    ) : (
                      <>
                        Approved for the {payload.audiences.find((a) => a.value === approval.audience)?.label.toLowerCase()} on {formatDateTime(approval.createdAt)}. Approved hash <span className="font-mono">{shortHash(approval.briefHash, 12)}</span>.
                      </>
                    )}
                  </span>
                </StatusDot>
              </div>
            )}

            <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
              <DialogTrigger asChild>
                <Button className="w-full" variant={approvedLive || released ? "outline" : "default"} disabled={!brief || editing || approvedLive || released || Boolean(jobId)} data-testid="open-approve">
                  <ShieldCheck /> {approvedLive || released ? "Approved" : "Approve this hash…"}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve brief v{brief?.versionNo}</DialogTitle>
                  <DialogDescription>You approve this exact text for one audience. Any edit changes the hash and voids the approval; any change to a cited claim, its decision, or the policy makes it stale.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground">Content hash (SHA-256)</div>
                    <div className="mt-0.5 rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all text-foreground" data-testid="approve-hash">
                      {brief?.contentHash}
                    </div>
                  </div>
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">Audience</span>
                    <select value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-sm" data-testid="approve-audience">
                      {payload.audiences.map((a) => (
                        <option key={a.value} value={a.value}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {approveError && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground" role="alert" data-testid="approve-error">
                      {approveError}
                    </p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setApproveOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={approve} disabled={busy} data-testid="confirm-approve">
                    Approve this hash
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button className="w-full" variant={approvedLive ? "default" : "outline"} disabled={!brief || busy || editing || released} onClick={doRelease} data-testid="release">
              <Send /> {released ? "Released" : "Release to the analyst"}
            </Button>
            <p className="text-xs text-muted-foreground">Release re-checks every condition on the server in one transaction: approval and its hash, audience, findings, attestation, processing issues, and staleness.</p>

            {release && !release.ok && (
              <div className="rounded-lg border bg-muted/40 p-3" data-testid="release-failures">
                <p className="text-sm font-medium text-foreground">Release blocked</p>
                <ul className="mt-1.5 space-y-1.5">
                  {release.failures.map((f, i) => (
                    <li key={i} className="text-sm text-foreground" data-testid="release-failure" data-code={f.code}>
                      <StatusDot tone="stop" className="items-start whitespace-normal [&>span:first-child]:mt-1.5">
                        <span>{f.message}</span>
                      </StatusDot>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(release?.ok || released) && (
              <div className="rounded-lg border bg-muted/40 p-3 text-sm text-foreground" data-testid="release-success">
                <StatusDot tone="good" className="items-start whitespace-normal [&>span:first-child]:mt-1.5">
                  <span>
                    Released. Every release condition held. The analyst sees brief v{brief?.versionNo} on the <Link href="/analyst" className="font-medium underline underline-offset-2">Released briefs</Link> page.
                  </span>
                </StatusDot>
              </div>
            )}
          </Panel>

          <Panel title={`${plural(payload.eligibility.eligibleCount, "eligible claim")}, ${payload.eligibility.withheldCount} withheld`} bodyClassName="p-0">
            <ul className="max-h-80 divide-y divide-border overflow-y-auto text-xs" data-testid="eligibility">
              {payload.eligibility.claims.map((c) => (
                <li key={c.key} className="flex gap-2 px-3 py-1.5" data-eligible={c.eligible}>
                  <span className={cn("w-7 shrink-0 font-mono font-semibold", c.eligible ? "text-foreground" : "text-muted-foreground")}>{c.key}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("line-clamp-2", c.eligible ? "text-foreground" : "text-muted-foreground")}>{c.summary}</span>
                    {!c.eligible && <span className="text-foreground">{c.reason === "restricted" ? `Withheld: ${c.detail}` : c.detail}</span>}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">{c.turnLabels.join("+")}</span>
                </li>
              ))}
            </ul>
          </Panel>

          {payload.versions.length > 1 && (
            <Panel title="Versions" bodyClassName="p-3">
              <ul className="space-y-1 text-xs">
                {payload.versions.map((v) => (
                  <li key={v.id} className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">v{v.versionNo}</span>
                    <StateChip state={v.status} />
                    <span className="font-mono text-muted-foreground">{shortHash(v.contentHash, 8)}</span>
                    <span className="ml-auto text-muted-foreground">{SOURCE_LABEL[v.draftSource] ?? v.draftSource}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </main>
  );
}
