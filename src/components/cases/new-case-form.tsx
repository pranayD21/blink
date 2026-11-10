"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Panel } from "@/components/app/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Job {
  employer: string;
  title: string;
  start: string;
  end: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {hint && <span className="ml-1.5 text-xs text-slate-400">{hint}</span>}
      <div className="mt-0.5">{children}</div>
    </label>
  );
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Case intake (§15.1): packet, expert profile, optional transcript, with a structured preview before submit. */
export function NewCaseForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [ticker, setTicker] = useState("");
  const [aliases, setAliases] = useState("");
  const [fyEnd, setFyEnd] = useState(12);
  const [lastFy, setLastFy] = useState("");
  const [lastQ, setLastQ] = useState("1");
  const [reportedOn, setReportedOn] = useState("");
  const [nextReport, setNextReport] = useState("");
  const [callDate, setCallDate] = useState("");
  const [questions, setQuestions] = useState<string[]>([""]);
  const [notes, setNotes] = useState("");
  const [expertName, setExpertName] = useState("");
  const [expertEmployer, setExpertEmployer] = useState("");
  const [expertTitle, setExpertTitle] = useState("");
  const [network, setNetwork] = useState("");
  const [jobs, setJobs] = useState<Job[]>([{ employer: "", title: "", start: "", end: "" }]);
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanQuestions = questions.map((q) => q.trim()).filter((q) => q.length >= 3);
  const cleanJobs = jobs.filter((j) => j.employer.trim());
  const aliasList = aliases.split(",").map((a) => a.trim()).filter(Boolean);

  const missing = [
    title.trim().length < 3 && "case title",
    issuer.trim().length < 2 && "covered issuer",
    !ticker.trim() && "ticker",
    !isDate(callDate) && "call date",
    !/^\d{4}$/.test(lastFy) && "last reported fiscal year",
    !isDate(reportedOn) && "date the last quarter was reported",
    cleanQuestions.length === 0 && "at least one research question",
    expertName.trim().length < 2 && "expert name",
    cleanJobs.some((j) => (j.start && !isDate(j.start)) || (j.end && !isDate(j.end))) && "employment dates as YYYY-MM-DD",
  ].filter(Boolean) as string[];

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ caseId: string }>("/api/cases", {
        body: {
          title,
          issuer,
          ticker: ticker.toUpperCase(),
          aliases: aliasList,
          issuer_fiscal: { fiscal_year_end_month: fyEnd, last_reported: { fy: Number(lastFy), q: Number(lastQ), reported_on: reportedOn }, next_report_expected: isDate(nextReport) ? nextReport : null },
          call_date: callDate,
          research_questions: cleanQuestions,
          analyst_notes: notes,
          expert: { name: expertName, current_employer: expertEmployer, current_title: expertTitle, employment: cleanJobs.map((j) => ({ employer: j.employer.trim(), title: j.title.trim(), start: j.start || null, end: j.end || null })), network, network_attestation: {} },
        },
      });
      if (transcript.trim()) {
        try {
          await api(`/api/cases/${created.caseId}/transcripts`, { body: { text: transcript, source: "ai" } });
        } catch (err) {
          // The case exists; the transcript can be uploaded again from its page, where speakers can be mapped.
          setError(`The case was created, but the transcript was not accepted: ${errorMessage(err)}`);
        }
      }
      router.push(`/cases/${created.caseId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_22rem] items-start gap-4">
      <div className="space-y-4">
        <Panel title="Covered issuer and call" bodyClassName="grid grid-cols-2 gap-3">
          <Field label="Case title" className="col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme Valves — channel check" data-testid="case-title" />
          </Field>
          <Field label="Covered issuer">
            <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Acme Valves, Inc." data-testid="case-issuer" />
          </Field>
          <Field label="Ticker">
            <Input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="ACMV" className="uppercase" data-testid="case-ticker" />
          </Field>
          <Field label="Aliases" hint="comma-separated; how the expert may refer to the issuer" className="col-span-2">
            <Input value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Acme, Acme Valves" />
          </Field>
          <Field label="Call date">
            <Input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} data-testid="case-call-date" />
          </Field>
        </Panel>

        <Panel title="Fiscal calendar" bodyClassName="grid grid-cols-4 gap-3">
          <p className="col-span-4 -mt-1 text-xs text-slate-500">Blink uses this to decide whether a period the expert mentions has already been reported.</p>
          <Field label="Fiscal year ends in">
            <select value={fyEnd} onChange={(e) => setFyEnd(Number(e.target.value))} className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm">
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Last reported: fiscal year">
            <Input value={lastFy} onChange={(e) => setLastFy(e.target.value)} placeholder="2027" inputMode="numeric" data-testid="case-last-fy" />
          </Field>
          <Field label="Quarter">
            <select value={lastQ} onChange={(e) => setLastQ(e.target.value)} className="h-8 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm">
              {[1, 2, 3, 4].map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reported on">
            <Input type="date" value={reportedOn} onChange={(e) => setReportedOn(e.target.value)} data-testid="case-reported-on" />
          </Field>
          <Field label="Next report expected" hint="optional" className="col-span-2">
            <Input type="date" value={nextReport} onChange={(e) => setNextReport(e.target.value)} />
          </Field>
        </Panel>

        <Panel title="Research questions" bodyClassName="space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="flex gap-2">
              <Input value={q} onChange={(e) => setQuestions((all) => all.map((x, j) => (j === i ? e.target.value : x)))} placeholder="What you want to learn from this call" data-testid={`case-question-${i}`} />
              {questions.length > 1 && (
                <Button size="icon" variant="ghost" onClick={() => setQuestions((all) => all.filter((_, j) => j !== i))} aria-label="Remove question">
                  <Trash2 />
                </Button>
              )}
            </div>
          ))}
          <Button size="xs" variant="outline" onClick={() => setQuestions((all) => [...all, ""])}>
            <Plus /> Question
          </Button>
          <Field label="Notes for compliance" hint="optional">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="h-16 text-sm" />
          </Field>
        </Panel>

        <Panel title="Expert profile" bodyClassName="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name">
              <Input value={expertName} onChange={(e) => setExpertName(e.target.value)} data-testid="case-expert-name" />
            </Field>
            <Field label="Current employer">
              <Input value={expertEmployer} onChange={(e) => setExpertEmployer(e.target.value)} />
            </Field>
            <Field label="Current title">
              <Input value={expertTitle} onChange={(e) => setExpertTitle(e.target.value)} />
            </Field>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-600">
              Employment history <span className="font-normal text-slate-400">dates decide whether the expert is a recent employee of the issuer</span>
            </div>
            <div className="mt-1 space-y-2">
              {jobs.map((job, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_9rem_9rem_auto] gap-2">
                  <Input value={job.employer} onChange={(e) => setJobs((all) => all.map((x, j) => (j === i ? { ...x, employer: e.target.value } : x)))} placeholder="Employer" data-testid={`job-employer-${i}`} />
                  <Input value={job.title} onChange={(e) => setJobs((all) => all.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} placeholder="Title" />
                  <Input type="date" value={job.start} onChange={(e) => setJobs((all) => all.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} aria-label="Start date" />
                  <Input type="date" value={job.end} onChange={(e) => setJobs((all) => all.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} aria-label="End date (empty if current)" />
                  <Button size="icon" variant="ghost" onClick={() => setJobs((all) => (all.length > 1 ? all.filter((_, j) => j !== i) : all))} aria-label="Remove row">
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <Button size="xs" variant="outline" className="mt-2" onClick={() => setJobs((all) => [...all, { employer: "", title: "", start: "", end: "" }])}>
              <Plus /> Employer
            </Button>
          </div>
          <Field label="Expert network" hint="optional">
            <Input value={network} onChange={(e) => setNetwork(e.target.value)} placeholder="Meridian Expert Network" />
          </Field>
        </Panel>

        <Panel title="Transcript (optional now)">
          <Textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={"Paste the transcript, or upload it from the case page later (where unknown speakers can be mapped).\n[00:01:10] Expert (J. Doe): …"} className="h-28 font-mono text-xs" />
        </Panel>
      </div>

      <div className="sticky top-16 space-y-4">
        <Panel title="Packet preview" bodyClassName="p-3">
          <dl className="space-y-2 text-sm" data-testid="packet-preview">
            <div>
              <dt className="text-xs text-slate-500">Case</dt>
              <dd className="text-slate-900">{title || <span className="text-slate-300">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Issuer</dt>
              <dd>
                {issuer || <span className="text-slate-300">—</span>} {ticker && <span className="text-slate-500">({ticker.toUpperCase()})</span>}
                {aliasList.length > 0 && <div className="text-xs text-slate-500">also: {aliasList.join(", ")}</div>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Call date</dt>
              <dd>{isDate(callDate) ? formatDate(callDate) : <span className="text-slate-300">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Fiscal calendar</dt>
              <dd>
                Year ends in {MONTHS[fyEnd - 1]}.{" "}
                {/^\d{4}$/.test(lastFy) && isDate(reportedOn) ? (
                  <>
                    Last reported Q{lastQ} FY{lastFy} on {formatDate(reportedOn)}.
                  </>
                ) : (
                  <span className="text-slate-300">Last reported quarter not set.</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Research questions</dt>
              <dd>{cleanQuestions.length > 0 ? <ul className="list-disc pl-4">{cleanQuestions.map((q) => <li key={q}>{q}</li>)}</ul> : <span className="text-slate-300">—</span>}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Expert</dt>
              <dd>
                {expertName || <span className="text-slate-300">—</span>}
                {cleanJobs.map((j, i) => (
                  <div key={i} className="text-xs text-slate-500">
                    {j.employer}
                    {j.title ? `, ${j.title}` : ""} · {j.start || "?"} to {j.end || "present"}
                  </div>
                ))}
              </dd>
            </div>
          </dl>
        </Panel>
        {missing.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="missing-fields">
            <p className="font-medium">Still needed:</p>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">The packet is complete.</p>
        )}
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        <Button className="w-full" disabled={busy || missing.length > 0} onClick={submit} data-testid="create-case">
          {busy ? "Creating…" : "Create case"}
        </Button>
      </div>
    </div>
  );
}
