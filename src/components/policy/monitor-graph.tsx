"use client";

import { Background, type Edge, Handle, MarkerType, type Node, type NodeProps, Position, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { Monitor } from "@/core/policy/schema";
import { humanize } from "@/lib/format";

const POSITION: Record<string, { x: number; y: number }> = {
  UNASSESSED: { x: 0, y: 120 },
  // The middle column sits left of center so its vertical edges clear the label of the direct edge.
  NEEDS_CONTEXT: { x: 190, y: 0 },
  NOT_TRIGGERED: { x: 190, y: 240 },
  REVIEW_REQUIRED: { x: 610, y: 120 },
  ESCALATION_REQUESTED: { x: 610, y: 280 },
};

/** The dot beside each state's name: the same tones the rest of the app gives these states. */
const STATE_DOT: Record<string, string> = {
  UNASSESSED: "var(--muted-foreground)",
  NEEDS_CONTEXT: "var(--warning)",
  NOT_TRIGGERED: "var(--muted-foreground)",
  REVIEW_REQUIRED: "var(--destructive)",
  ESCALATION_REQUESTED: "transparent",
};

const RESULT_COLOR: Record<string, string> = { true: "var(--destructive)", indeterminate: "var(--warning)", false: "var(--muted-foreground)" };

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
  const open = state === "ESCALATION_REQUESTED";
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", borderRadius: 8, fontSize: 12, fontWeight: 500, padding: "8px 10px", width: 170, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, flexShrink: 0, borderRadius: 9999, background: STATE_DOT[state] ?? "var(--muted-foreground)", border: open ? "1.5px solid var(--muted-foreground)" : "none" }} />
      {humanize(state)}
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
        labelStyle: { fill: "var(--foreground)", fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: "var(--card)", fillOpacity: 0.92 },
        labelBgPadding: [4, 2] as [number, number],
      };
    });
    return { nodes, edges };
  }, [monitor]);

  return (
    <div className="h-80 w-full rounded-lg border bg-muted/40" data-testid={`monitor-graph-${monitor.monitor_id}`}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.12 }} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} zoomOnScroll={false} panOnDrag={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false} proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="var(--border)" />
      </ReactFlow>
    </div>
  );
}
