"use client";

import type { FsmState, KleeneVal, MonitorSnapshot } from "./call-data";

const STATE_LABEL: Record<FsmState, string> = {
  UNASSESSED: "Listening",
  NEEDS_CONTEXT: "Needs context",
  NOT_TRIGGERED: "Safe",
  REVIEW_REQUIRED: "Flagged",
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

/** Single-frame state machine and condition checklist without nested card wrappers. */
export function FsmDiagram({ monitor }: { monitor: Omit<MonitorSnapshot, "id"> & { id: string } }) {
  const rightState = monitor.terminalState;
  const nodes: { id: FsmState; x: number; y: number; w: number }[] = [
    { id: "UNASSESSED", x: 8, y: 69, w: 122 },
    { id: "NEEDS_CONTEXT", x: 164, y: 10, w: 148 },
    { id: "NOT_TRIGGERED", x: 164, y: 128, w: 148 },
    { id: rightState, x: 344, y: 69, w: 118 },
  ];

  const isEdgeOn = (from: FsmState, to: FsmState, res: KleeneVal) =>
    monitor.prevState === from && monitor.state === to && monitor.edgeResult === res;

  const edges: { from: FsmState; to: FsmState; res: KleeneVal; d: string }[] = [
    { from: "UNASSESSED", to: "NEEDS_CONTEXT", res: "indeterminate", d: "M 130 82 C 148 82, 148 33, 164 33" },
    { from: "UNASSESSED", to: "NOT_TRIGGERED", res: "false", d: "M 130 102 C 148 102, 148 151, 164 151" },
    { from: "UNASSESSED", to: rightState, res: "true", d: "M 130 92 L 344 92" },
    { from: "NEEDS_CONTEXT", to: rightState, res: "true", d: "M 312 33 C 328 33, 328 82, 344 82" },
  ];

  return (
    <div className="space-y-4" data-testid={`fsm-${monitor.id}`}>
      <svg
        viewBox="0 0 470 184"
        className="h-auto w-full select-none"
        role="img"
        aria-label={`State machine for ${monitor.title}, current state ${STATE_LABEL[monitor.state]}`}
      >
        <defs>
          <marker id={`arrow-muted-${monitor.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--border)" />
          </marker>
          <marker id={`arrow-true-${monitor.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--destructive)" />
          </marker>
          <marker id={`arrow-indeterminate-${monitor.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--warning)" />
          </marker>
          <marker id={`arrow-false-${monitor.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--success)" />
          </marker>
        </defs>

        {edges.map((edge) => {
          const on = isEdgeOn(edge.from, edge.to, edge.res);
          const marker = on ? `url(#arrow-${edge.res}-${monitor.id})` : `url(#arrow-muted-${monitor.id})`;
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={edge.d}
              fill="none"
              stroke={edgeStroke(edge.res, on)}
              strokeWidth={on ? 2.8 : 1.5}
              strokeDasharray={on ? undefined : "4 4"}
              markerEnd={marker}
            />
          );
        })}

        {nodes.map((node) => {
          const active = monitor.state === node.id;
          const visited = monitor.prevState === node.id || active;
          const dot = stateColor(node.id, visited);
          return (
            <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
              <rect
                width={node.w}
                height={46}
                rx={23}
                fill={active ? "var(--secondary)" : "var(--card)"}
                stroke={active ? dot : "var(--border)"}
                strokeWidth={active ? 2.4 : 1.3}
              />
              <circle cx={20} cy={23} r={5} fill={dot} />
              <text
                x={33}
                y={28}
                style={{
                  fontSize: 14.5,
                  fontWeight: active ? 600 : 450,
                  fill: active ? "var(--foreground)" : "var(--muted-foreground)",
                }}
              >
                {STATE_LABEL[node.id]}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="divide-y border-t text-base">
        {monitor.conditions.map((cond) => (
          <li key={cond.label} className="flex items-center justify-between gap-4 py-2.5">
            <span className="text-muted-foreground">{cond.label}</span>
            <span
              className={
                cond.tri === "true"
                  ? "shrink-0 font-semibold text-destructive"
                  : cond.tri === "indeterminate"
                    ? "shrink-0 font-semibold text-warning"
                    : "shrink-0 font-semibold text-success"
              }
            >
              {cond.answer}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
