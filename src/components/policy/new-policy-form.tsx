"use client";

import { FileText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-shell";
import { StatusDot } from "@/components/app/status-dot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "@/lib/api";

export interface PolicyPreset {
  label: string;
  title: string;
  text: string;
  requiredParagraphs: string[];
  scenarios: unknown;
  scenarioCount: number;
}

/** Paragraphs are marked [P1], [P2], … in the source text (§17.2). */
function paragraphsOf(text: string): { id: string; text: string }[] {
  return [...text.matchAll(/\[(P\d+)\]\s*([^\n]*(?:\n(?!\s*\n|\[P\d+\])[^\n]*)*)/g)].map((m) => ({ id: m[1], text: m[2].trim() }));
}

export function NewPolicyForm({ presets }: { presets: PolicyPreset[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [required, setRequired] = useState<string[]>([]);
  const [scenarios, setScenarios] = useState<{ value: unknown; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paragraphs = useMemo(() => paragraphsOf(text), [text]);

  function load(p: PolicyPreset) {
    setTitle(p.title);
    setText(p.text);
    setRequired(p.requiredParagraphs);
    setScenarios({ value: p.scenarios, count: p.scenarioCount });
    setError(null);
  }

  async function submit(compile: boolean) {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ policyVersionId: string }>("/api/policies", { body: { title, text, requiredParagraphs: required.filter((p) => paragraphs.some((x) => x.id === p)), ...(scenarios ? { scenarios: scenarios.value } : {}) } });
      if (compile) await api(`/api/policies/${created.policyVersionId}/compile`, { body: {} });
      router.push(`/policies/${created.policyVersionId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const missing = [title.trim().length < 3 ? "a title" : null, paragraphs.length === 0 ? "policy text with paragraphs marked [P1], [P2], …" : null].filter(Boolean);

  return (
    <div className="grid grid-cols-[1fr_20rem] items-start gap-4">
      <Panel title="Policy text" bodyClassName="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Synthetic fixtures:</span>
          {presets.map((p) => (
            <Button key={p.label} type="button" size="sm" variant="outline" onClick={() => load(p)} data-testid={`preset-${p.label}`}>
              <FileText /> {p.label}
            </Button>
          ))}
        </div>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, for example: Expert Call Policy v2" data-testid="policy-title" />
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"Paste the policy in plain language. Mark each paragraph:\n\n[P1] This policy applies to…\n\n[P2] Compliance must review any statement…"} className="h-96 font-mono text-xs leading-relaxed" data-testid="policy-text" />
        {error && (
          <p role="alert">
            <StatusDot tone="stop" className="items-start text-sm whitespace-normal [&>span:first-child]:mt-1.5">
              {error}
            </StatusDot>
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {missing.length > 0 && <StatusDot tone="warn" className="mr-auto text-xs text-muted-foreground">Still needed: {missing.join("; ")}.</StatusDot>}
          <Button variant="outline" size="sm" disabled={busy || missing.length > 0} onClick={() => submit(false)}>
            Save draft
          </Button>
          <Button size="sm" disabled={busy || missing.length > 0} onClick={() => submit(true)} data-testid="create-and-compile">
            {busy ? "Starting…" : "Create draft and compile"}
          </Button>
        </div>
      </Panel>

      <div className="space-y-4">
        <Panel title="Paragraphs that must be automated" bodyClassName="p-3">
          <p className="mb-2 text-xs text-muted-foreground">If the compiler cannot turn a ticked paragraph into a rule, the version fails validation instead of quietly leaving it out.</p>
          {paragraphs.length === 0 ? (
            <p className="text-xs text-muted-foreground">Paragraphs appear here once the text has [P1]-style markers.</p>
          ) : (
            <ul className="space-y-1.5">
              {paragraphs.map((p) => (
                <li key={p.id}>
                  <label className="flex items-start gap-2 text-xs">
                    <Checkbox checked={required.includes(p.id)} onCheckedChange={(v) => setRequired((r) => (v === true ? [...new Set([...r, p.id])] : r.filter((x) => x !== p.id)))} className="mt-0.5" data-testid={`required-${p.id}`} />
                    <span>
                      <span className="font-mono font-semibold text-foreground">{p.id}</span> <span className="line-clamp-2 text-muted-foreground">{p.text}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Reviewer-authored scenarios" bodyClassName="p-3">
          {scenarios ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{scenarios.count} scenarios</span> loaded with the fixture. They were written before any model tuning, and every one must pass for the version to validate.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">None. Scenarios are the acceptance tests a compiled policy must pass. The fixture policies come with eight.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
