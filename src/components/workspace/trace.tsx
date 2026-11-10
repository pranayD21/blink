"use client";

import { StateChip } from "@/components/app/status-chip";
import { predicatePhrase } from "@/core/predicates/registry";
import type { GuardTraceNode } from "@/core/runtime/monitorReducer";
import { cn } from "@/lib/utils";
import type { ClaimMonitorView, ClaimView, WorkspacePayload } from "@/server/services/workspace";
import { EVIDENCE_MARK, TRI_LABEL } from "./model";

function TraceNode({ node, assessments, depth }: { node: GuardTraceNode; assessments: ClaimMonitorView["assessments"]; depth: number }) {
  if (node.op === "pred") {
    const mark = EVIDENCE_MARK[node.state];
    return (
      <div className="flex gap-2 py-0.5" style={{ paddingLeft: depth * 14 }} data-testid={`trace-leaf-${node.name}`} data-state={node.state}>
        <span className={cn("w-3 shrink-0 text-center font-semibold", mark.className)}>{mark.mark}</span>
        <div className="min-w-0">
          <div>
            <span className="text-slate-800">{predicatePhrase(node.name, node.params)}</span> <span className={cn("font-medium", mark.className)}>{mark.label}</span>
          </div>
          {assessments[node.key]?.explanation && <div className="text-xs text-slate-500">{assessments[node.key].explanation}</div>}
        </div>
      </div>
    );
  }
  const tri = TRI_LABEL[node.tri];
  return (
    <div>
      <div className="py-0.5 font-mono text-xs" style={{ paddingLeft: depth * 14 }}>
        <span className="font-semibold text-slate-700">{node.op.toUpperCase()}</span> <span className={tri.className}>{tri.label}</span>
      </div>
      {node.children.map((child, i) => (
        <TraceNode key={i} node={child} assessments={assessments} depth={depth + 1} />
      ))}
    </div>
  );
}

/** "Why": every rule's guard as it evaluated for this claim, leaf by leaf (§15.2). */
export function RuleTraces({ claim, payload }: { claim: ClaimView; payload: WorkspacePayload }) {
  if (claim.monitors.length === 0) return <p className="text-sm text-slate-500">This claim has not been evaluated against a policy.</p>;
  const ruleInfo = new Map((payload.policy?.rules ?? []).map((r) => [r.ruleId, r]));
  // Triggered rules first, then those waiting for context, then the rest.
  const rank = (m: ClaimMonitorView) => (m.state === "REVIEW_REQUIRED" || m.state === "ESCALATION_REQUESTED" ? 0 : m.state === "NEEDS_CONTEXT" ? 1 : 2);
  const monitors = [...claim.monitors].sort((a, b) => rank(a) - rank(b) || a.ruleId.localeCompare(b.ruleId));

  return (
    <div className="space-y-2">
      {monitors.map((m) => {
        const rule = ruleInfo.get(m.ruleId);
        const quiet = rank(m) === 2;
        return (
          <details key={m.monitorId} open={!quiet} className="group rounded-lg border bg-white" data-testid={`trace-${m.ruleId}`} data-state={m.state}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
              <span className="font-mono font-semibold text-slate-900">Rule {m.ruleId}</span>
              {rule && rule.sourceClauses.length > 0 && (
                <span className="font-mono text-xs text-slate-500">
                  ← clause {rule.sourceClauses.map((c) => `${c.id}${c.paragraph ? ` (${c.paragraph})` : ""}`).join(", ")}
                </span>
              )}
              <StateChip state={m.state} className="ml-auto" />
            </summary>
            <div className="border-t px-3 py-2 text-sm">
              {rule && <p className="mb-1.5 text-xs text-slate-600">{rule.intent}</p>}
              {m.trace ? <TraceNode node={m.trace} assessments={m.assessments} depth={0} /> : <p className="text-xs text-slate-500">No evaluation recorded.</p>}
              {rule && rule.sourceClauses[0]?.verbatim && (
                <blockquote className="mt-2 border-l-2 border-slate-200 pl-2 text-xs text-slate-500 italic">
                  {rule.sourceClauses[0].paragraph}: “{rule.sourceClauses[0].verbatim}”
                </blockquote>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}
