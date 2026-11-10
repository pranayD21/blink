"use client";

import { FileText, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";

export interface TranscriptSample {
  label: string;
  filename: string;
  sourceLabel: string;
  text: string;
}

interface Preview {
  format: string;
  turnCount: number;
  unknownSpeakers: string[];
  speakers: { name: string; role: string }[];
  turns: { label: string; speaker: string; speakerName: string; text: string }[];
}

type Role = "analyst" | "expert" | "moderator";

/** Shared by the analyst's case page and the review workspace. */
export function TranscriptUploadForm({ caseId, samples, allowGold, onUploaded, onCancel }: { caseId: string; samples: TranscriptSample[]; allowGold: boolean; onUploaded: (jobId: string, versionNo: number) => void; onCancel?: () => void }) {
  const [text, setText] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [speakerMap, setSpeakerMap] = useState<Record<string, Role>>({});
  const [gold, setGold] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function runPreview(nextText: string, nextFilename: string | null, map: Record<string, Role>) {
    setError(null);
    if (!nextText.trim()) {
      setPreview(null);
      return;
    }
    try {
      setPreview(await api<Preview>("/api/transcripts/preview", { body: { text: nextText, filename: nextFilename, speakerMap: Object.keys(map).length > 0 ? map : undefined } }));
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err));
    }
  }

  function load(nextText: string, nextFilename: string | null, label?: string) {
    setText(nextText);
    setFilename(nextFilename);
    setSourceLabel(label);
    setSpeakerMap({});
    void runPreview(nextText, nextFilename, {});
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ jobId: string; versionNo: number }>(`/api/cases/${caseId}/transcripts`, { body: { text, filename, sourceLabel, speakerMap: Object.keys(speakerMap).length > 0 ? speakerMap : undefined, source: gold ? "gold" : "ai" } });
      onUploaded(result.jobId, result.versionNo);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const hasExpert = preview?.speakers.some((s) => s.role === "expert") ?? false;

  return (
    <div className="min-w-0 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.vtt,.json,text/plain"
          className="hidden"
          data-testid="transcript-file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) load(await file.text(), file.name);
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload /> Choose file (.txt, .vtt, .json)
        </Button>
        {samples.map((s) => (
          <Button key={s.filename} type="button" variant="outline" size="sm" onClick={() => load(s.text, s.filename, s.sourceLabel)} data-testid={`sample-${s.filename}`}>
            <FileText /> {s.label}
          </Button>
        ))}
      </div>
      <Textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setFilename(null);
        }}
        onBlur={() => void runPreview(text, filename, speakerMap)}
        placeholder={"…or paste the transcript here.\n[00:01:10] Expert (R. Castellano): Orders fell off a cliff."}
        className="field-sizing-fixed h-36 w-full font-mono text-xs"
        data-testid="transcript-text"
      />

      {preview && (
        <div className="min-w-0 rounded-lg border bg-slate-50 p-3" data-testid="transcript-preview">
          <div className="text-xs font-medium text-slate-700">
            Parsed as {preview.format.toUpperCase()}: {preview.turnCount} turns{filename ? ` from ${filename}` : ""}
          </div>
          <div className="mt-2 grid gap-1.5">
            {preview.speakers.map((s) => {
              const unknown = preview.unknownSpeakers.includes(s.name);
              return (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <span className="w-48 truncate font-medium text-slate-800">{s.name}</span>
                  {unknown || speakerMap[s.name] ? (
                    <Select
                      value={speakerMap[s.name] ?? ""}
                      onValueChange={(v) => {
                        const next = { ...speakerMap, [s.name]: v as Role };
                        setSpeakerMap(next);
                        void runPreview(text, filename, next);
                      }}
                    >
                      <SelectTrigger size="sm" className="h-7 w-40 bg-white text-xs">
                        <SelectValue placeholder="Who is this?" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="analyst">Analyst</SelectItem>
                        <SelectItem value="expert">Expert</SelectItem>
                        <SelectItem value="moderator">Moderator</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-slate-600 capitalize">{s.role}</span>
                  )}
                </div>
              );
            })}
          </div>
          {!hasExpert && <p className="mt-2 text-xs text-amber-800">No expert speaker is mapped yet. Map the speakers so Blink knows whose statements to evaluate.</p>}
          <div className="mt-2 max-h-28 space-y-0.5 overflow-y-auto border-t pt-2 text-xs text-slate-600">
            {preview.turns.map((t) => (
              <div key={t.label} className="truncate">
                <span className="font-mono text-slate-400">{t.label}</span> <span className="font-medium text-slate-700">{t.speakerName}:</span> {t.text}
              </div>
            ))}
            {preview.turnCount > preview.turns.length && <div className="text-slate-400">… {preview.turnCount - preview.turns.length} more</div>}
          </div>
        </div>
      )}

      {allowGold && (
        <label className="flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-slate-600">
          <Checkbox checked={gold} onCheckedChange={(v) => setGold(v === true)} className="mt-0.5" />
          <span>
            <span className="font-medium text-slate-800">Development only:</span> load hand-labeled claims instead of calling the model. Works for the seeded Halvorsen transcript; the run is labeled as hand-labeled everywhere.
          </span>
        </label>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="button" size="sm" disabled={busy || !preview || !hasExpert} onClick={submit} data-testid="upload-transcript-submit">
          {busy ? "Uploading…" : "Upload and analyze"}
        </Button>
      </div>
    </div>
  );
}

export function UploadTranscriptDialog({ caseId, samples, allowGold, currentVersion, onUploaded, trigger }: { caseId: string; samples: TranscriptSample[]; allowGold: boolean; currentVersion: number | null; onUploaded: (jobId: string) => void; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" data-testid="open-upload">
            <Upload /> {currentVersion ? "Upload corrected transcript" : "Upload transcript"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{currentVersion ? `Upload a new transcript version (current: v${currentVersion})` : "Upload the call transcript"}</DialogTitle>
          <DialogDescription>
            {currentVersion
              ? "Blink compares the new version with the current one turn by turn. Only claims that quote a changed turn are re-extracted, and only the decisions, attestations, and approvals that depended on them reopen."
              : "Blink parses the turns, extracts the expert's claims with exact quotes, compares them with public documents, and evaluates the approved policy."}
          </DialogDescription>
        </DialogHeader>
        <TranscriptUploadForm
          caseId={caseId}
          samples={samples}
          allowGold={allowGold}
          onCancel={() => setOpen(false)}
          onUploaded={(jobId) => {
            setOpen(false);
            onUploaded(jobId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
