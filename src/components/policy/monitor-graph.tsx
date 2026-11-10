"use client";

import { Background, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Monitor } from "@/core/policy/schema";

const POSITION: Record<string, { x: number; y: number }> = {
  UNASSESSED: { x: 0, y: 120 },
  // The middle column sits left of center so its vertical edges clear the label of the direct edge.
  NEEDS_CONTEXT: { x: 190, y: 0 },
  NOT_TRIGGERED: { x: 190, y: 240 },
  REVIEW_REQUIRED: { x: 610, y: 120 },
  ESCALATION_REQUESTED: { x: 610, y: 280 },
};

const STATE_STYLE: Record<string, React.CSSProperties> = {
  UNASSESSED: { background: "#f1f5f9", borderColor: "#cbd5e1", color: "#334155" },
  NEEDS_CONTEXT: { background: "#fffbeb", borderColor: "#fcd34d", color: "#92400e" },
  NOT_TRIGGERED: { background: "#f1f5f9", borderColor: "#cbd5e1", color: "#475569" },
  REVIEW_REQUIRED: { background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" },
  ESCALATION_REQUESTED: { background: "#f5f3ff", borderColor: "#c4b5fd", color: "#6d28d9" },
};

const RESULT_COLOR: Record<string, string> = { true: "#dc2626", indeterminate: "#d97706", false: "#64748b" };

/**
 * Which side each edge leaves and enters by, so the two edges between
 * NEEDS_CONTEXT and NOT_TRIGGERED run side by side instead of crossing the
 * direct edge's label in the middle of the graph.
 */
const ROUTE: Record<string, [string, string]> = {
  "UNASSESSED>NEEDS_CONTEXT": ["top-out", "left"],
  "UNASSESSED>NOT_TRIGGERED": ["bottom-out", "left"],
  "UNASSESSED>REVIEW_REQUIRED": ["right", "left"],
  "NEEDS_CONTEXT>REVIEW_REQUIRED": ["right", "top-in"],
  "NOT_TRIGGERED>REVIEW_REQUIRED": ["right", "bottom-in"],
  "NEEDS_CONTEXT>NOT_TRIGGERED": ["bottom-out", "top-in"],
  "NOT_TRIGGERED>NEEDS_CONTEXT": ["top-out", "bottom-in"],
};

const hidden: React.CSSProperties = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: "none" };

function StateNode({ data }: NodeProps) {
  const state = String(data.label);
  return (
    <div style={{ ...STATE_STYLE[state], borderWidth: 1.5, borderStyle: "solid", borderRadius: 8, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, fontWeight: 600, padding: "8px 10px", width: 170, textAlign: "center" }}>
      {state}
      <Handle type="target" id="left" position={Position.Left} style={hidden} />
      <Handle type="source" id="right" position={Position.Right} style={hidden} />
      <Handle type="target" id="top-in" position={Position.Top} style={{ ...hidden, left: "30%" }} />
      <Handle type="source" id="top-out" position={Position.Top} style={{ ...hidden, left: "70%" }} />
      <Handle type="source" id="bottom-out" position={Position.Bottom} style={{ ...hidden, left: "30%" }} />
      <Handle type="target" id="bottom-in" position={Position.Bottom} style={{ ...hidden, left: "70%" }} />
    </div>
  );
}

const nodeTypes = { state: StateNode };

/**
 * One monitor as a state graph. Edges are grouped by (from, to, guard result);
 * both events share the same transitions in a well-formed monitor, so the
 * label names the result rather than the event. Self-loops are listed in the
 * transition table, not drawn.
 */
export function MonitorGraph({ monitor }: { monitor: Monitor }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = monitor.states.map((state, i) => ({ id: state, type: "state", position: POSITION[state] ?? { x: 130 * i, y: 360 }, data: { label: state }, draggable: false, selectable: false }));
    const grouped = new Map<string, { from: string; to: string; result: string; effects: Set<string> }>();
    for (const t of monitor.transitions) {
      for (const from of t.from) {
        if (from === t.to) continue;
        const key = `${from}|${t.to}|${t.result_is}`;
        const g = grouped.get(key) ?? { from, to: t.to, result: t.result_is, effects: new Set<string>() };
        for (const e of t.effects) g.effects.add(e);
        grouped.set(key, g);
      }
    }
    const edges: Edge[] = [...grouped.entries()].map(([key, g]) => {
      const [sourceHandle, targetHandle] = ROUTE[`${g.from}>${g.to}`] ?? ["right", "left"];
      return {
        id: key,
        source: g.from,
        target: g.to,
        sourceHandle,
        targetHandle,
        label: `${g.result}${g.effects.has("REQUEST_ESCALATION") ? " · escalate" : ""}`,
        markerEnd: { type: MarkerType.ArrowClosed, color: RESULT_COLOR[g.result] },
        style: { stroke: RESULT_COLOR[g.result], strokeWidth: 1.5 },
        labelStyle: { fill: RESULT_COLOR[g.result], fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.92 },
        labelBgPadding: [4, 2] as [number, number],
      };
    });
    return { nodes, edges };
  }, [monitor]);

  return (
    <div className="h-80 w-full rounded-lg border bg-slate-50/50" data-testid={`monitor-graph-${monitor.monitor_id}`}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} panOnDrag={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false} proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="#e2e8f0" />
      </ReactFlow>
    </div>
  );
}
