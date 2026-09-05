import type { Node, Edge } from "@xyflow/react";

/** The six node kinds a workflow can be built from. */
export const NODE_KINDS = [
  "input",
  "llm",
  "http",
  "transform",
  "condition",
  "output",
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Data types carried along an edge. `any` is assignable in both directions;
 * every other pair must match exactly. See `isPortCompatible`.
 */
export type PortType = "text" | "json" | "boolean" | "any";

export interface PortSpec {
  /** Stable id, used as the React Flow handle id. */
  id: string;
  label: string;
  type: PortType;
  /** Target ports only: permit more than one incoming edge. Defaults to false. */
  multiple?: boolean;
}

/** Per-node execution state, driven by the engine in step 3. */
export type NodeRunStatus = "idle" | "running" | "success" | "error" | "skipped";

export interface NodeRunState {
  status: NodeRunStatus;
  /** Populated on failure. */
  error?: string;
  /** Wall-clock duration of the last run, in milliseconds. */
  durationMs?: number;
}

/**
 * Config is stored as an open record and validated against the kind's Zod
 * schema at the edges (inspector edits, import, execution). Keeping it loose
 * in the store avoids a discriminated union everywhere a node is touched.
 */
export type NodeConfig = Record<string, unknown>;

export interface WorkflowNodeData extends Record<string, unknown> {
  kind: NodeKind;
  /** User-editable display name; falls back to the definition's label. */
  label: string;
  config: NodeConfig;
  run?: NodeRunState;
}

export type WorkflowNode = Node<WorkflowNodeData>;
export type WorkflowEdge = Edge;

/** Serialized form — what gets saved, exported, and later persisted. */
export interface WorkflowDocument {
  version: 1;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export function isPortCompatible(source: PortType, target: PortType): boolean {
  return source === "any" || target === "any" || source === target;
}
