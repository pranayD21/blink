"use client";

import type { FsmState, KleeneVal, MonitorSnapshot } from "./call-data";

const STATE_LABEL: Record<FsmState, string> = {
  UNASSESSED: "Unassessed",
  NEEDS_CONTEXT: "Needs context",
  NOT_TRIGGERED: "Not triggered",
  REVIEW_REQUIRED: "Review required",
  ESCALATION_REQUESTED: "Escalated",
};

function stateColor(state: FsmState, active: boolean): string {
  if (!active) return "var(--muted-foreground)";
  if (state === "REVIEW_REQUIRED" || state === "ESCALATION_REQUESTED") return "var(--destructive)";
  if (state === "NEEDS_CONTEXT") return "var(--warning)";
  if (state === "NOT_TRIGGERED") return "var(--success)";
  return "var(--foreground)";
}

function edgeStroke(kind: KleeneVal, active: boolean): string {
  if (!active) return "var(--border)";
  if (kind === "true") return "var(--destructive)";
  if (kind === "indeterminate") return "var(--warning)";
  return "var(--success)";
}

/** Interactive SVG state machine for M1, M2, or M4, showing live transitions and Kleene guard math. */
export function FsmDiagram({ monitor }: { monitor: MonitorSnapshot }) {
  const rightState = monitor.terminalState;
  const nodes: { id: FsmState; x: number; y: number }[] = [
    { id: "UNASSESSED", x: 18, y: 84 },
    { id: "NEEDS_CONTEXT", x: 256, y: 14 },
    { id: "NOT_TRIGGERED", x: 256, y: 154 },
    { id: rightState, x: 500, y: 84 },
  ];

  const isEdgeOn = (from: FsmState, to: FsmState, res: KleeneVal) =>
    monitor.prevState === from && monitor.state === to && monitor.edgeResult === res;

  const edges: { from: FsmState; to: FsmState; res: KleeneVal; d: string; lx: number; ly: number; label: string }[] = [
    {
      from: "UNASSESSED",
      to: "NEEDS_CONTEXT",
      res: "indeterminate",
      d: "M 178 96 C 212 96, 214 38, 256 38",
      lx: 196,
      ly: 54,
      label: "indeterminate",
    },
    {
      from: "UNASSESSED",
      to: "NOT_TRIGGERED",
      res: "false",
      d: "M 178 122 C 212 122, 214 178, 256 178",
      lx: 204,
      ly: 168,
      label: "false",
    },
    {
      from: "UNASSESSED",
      to: rightState,
      res: "true",
      d: "M 178 108 L 500 108",
      lx: 338,
      ly: 100,
      label: rightState === "ESCALATION_REQUESTED" ? "true · escalate" : "true",
    },
    {
      from: "NEEDS_CONTEXT",
      to: rightState,
      res: "true",
      d: "M 426 38 C 466 38, 468 96, 500 96",
      lx: 472,
      ly: 54,
      label: "true",
    },
    {
      from: "NEEDS_CONTEXT",
      to: "NOT_TRIGGERED",
      res: "false",
      d: "M 340 62 L 340 154",
      lx: 362,
      ly: 132,
      label: "false",
    },
  ];

  return (
    <div className="space-y-4" data-testid={`fsm-${monitor.id}`}>
      <div className="fsm-box">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-base font-medium text-foreground">
            Monitor {monitor.id} · Rule {monitor.ruleId} ({monitor.clause})
          </span>
          <span className="text-base text-muted-foreground">{monitor.title}</span>
        </div>

        <svg viewBox="0 0 680 216" className="h-auto w-full select-none" role="img" aria-label={`State machine ${monitor.id}, current state ${STATE_LABEL[monitor.state]}`}>
          <defs>
            <marker id="fsm-arrow-muted" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--border)" />
            </marker>
            <marker id="fsm-arrow-true" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--destructive)" />
            </marker>
            <marker id="fsm-arrow-indeterminate" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--warning)" />
            </marker>
            <marker id="fsm-arrow-false" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--success)" />
            </marker>
          </defs>

          {edges.map((edge) => {
            const on = isEdgeOn(edge.from, edge.to, edge.res);
            const marker = on ? `url(#fsm-arrow-${edge.res})` : "url(#fsm-arrow-muted)";
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <path
                  d={edge.d}
                  fill="none"
                  stroke={edgeStroke(edge.res, on)}
                  strokeWidth={on ? 2.6 : 1.4}
                  strokeDasharray={on ? undefined : "4 4"}
                  markerEnd={marker}
                />
                <text
                  x={edge.lx}
                  y={edge.ly}
                  textAnchor="middle"
                  style={{
                    fontSize: 12,
                    fill: on ? "var(--foreground)" : "var(--muted-foreground)",
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {edge.label}
                </text>
              </g>
            );
          })}

          {nodes.map((node) => {
            const active = monitor.state === node.id;
            const visited = monitor.path.some((p) => p.state === node.id);
            const dot = stateColor(node.id, active || visited);
            const width = node.id === "UNASSESSED" ? 160 : 170;
            return (
              <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
                <rect
                  width={width}
                  height={48}
                  rx={24}
                  fill={active ? "var(--secondary)" : "var(--card)"}
                  stroke={active ? dot : "var(--border)"}
                  strokeWidth={active ? 2.2 : 1.2}
                />
                <circle cx={22} cy={24} r={5} fill={dot} />
                <text
                  x={36}
                  y={28}
                  style={{
                    fontSize: 13.5,
                    fontWeight: active ? 600 : 400,
                    fill: active ? "var(--foreground)" : "var(--muted-foreground)",
                  }}
                >
                  {STATE_LABEL[node.id]}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-base text-muted-foreground" data-testid="live-fsm-path">
          <span>Path:</span>
          {monitor.path.map((step, i) => (
            <span key={`${step.state}-${i}`} className="inline-flex items-center gap-2">
              {i > 0 && <span aria-hidden>→</span>}
              <span className={i === monitor.path.length - 1 ? "font-medium text-foreground" : "text-muted-foreground"}>
                {STATE_LABEL[step.state]}
                {step.at ? ` (${step.at})` : ""}
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="fsm-box">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-base font-medium text-foreground">Kleene three-valued guard</span>
          <span className="text-base text-muted-foreground">
            Result:{" "}
            <span
              className={
                monitor.guardResult === "true"
                  ? "font-semibold text-destructive"
                  : monitor.guardResult === "indeterminate"
                    ? "font-semibold text-warning"
                    : "font-semibold text-success"
              }
            >
              {monitor.guardResult}
            </span>
          </span>
        </div>
        <p className="mt-1 text-base text-muted-foreground">{monitor.formula}</p>

        <ul className="mt-3 space-y-2.5">
          {monitor.predicates.map((pred) => (
            <li key={pred.name} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-muted/60 px-4 py-2.5 text-base">
              <div className="min-w-0">
                <span className="font-medium text-foreground">{pred.phrase}</span>
                <span className="ml-2 text-muted-foreground">· {pred.detail}</span>
              </div>
              <span
                className={
                  pred.tri === "true"
                    ? "shrink-0 font-medium text-destructive"
                    : pred.tri === "indeterminate"
                      ? "shrink-0 font-medium text-warning"
                      : "shrink-0 font-medium text-success"
                }
              >
                {pred.evidence} → {pred.tri}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
