import { create } from "zustand";
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { getDefinition } from "@/lib/nodes/definitions";
import { checkConnection } from "@/lib/graph/validation";
import type { RunEvent } from "@/lib/engine/types";
import type {
  NodeKind,
  NodeRunState,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/types/workflow";

/**
 * Ids double as the handle for template references ({{llm_1.text}}), so they
 * are readable and stable rather than random.
 */
function nextNodeId(nodes: WorkflowNode[], kind: NodeKind): string {
  let n = 1;
  const taken = new Set(nodes.map((node) => node.id));
  while (taken.has(`${kind}_${n}`)) n += 1;
  return `${kind}_${n}`;
}

export interface Rejection {
  reason: string;
  /** Timestamp, so repeat rejections of the same reason still retrigger the toast. */
  at: number;
}

export type RunPhase = "idle" | "running" | "success" | "error" | "cancelled";

interface WorkflowState {
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;
  rejection: Rejection | null;

  setName: (name: string) => void;
  onNodesChange: (changes: NodeChange<WorkflowNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<WorkflowEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addNode: (kind: NodeKind, position: XYPosition) => void;
  updateNodeConfig: (id: string, key: string, value: unknown) => void;
  renameNode: (id: string, label: string) => void;
  deleteNode: (id: string) => void;

  selectNode: (id: string | null) => void;
  dismissRejection: () => void;

  runPhase: RunPhase;
  runError: string | null;
  runOutputs: Record<string, unknown>;
  runDurationMs: number | null;
  beginRun: () => void;
  applyRunEvent: (event: RunEvent) => void;
  failRun: (message: string) => void;
  resetRun: () => void;

  clear: () => void;
  toDocument: () => WorkflowDocument;
  loadDocument: (doc: WorkflowDocument) => void;
}

/** Applies a run-state patch to one node without touching the others. */
function patchNodeRun(
  nodes: WorkflowNode[],
  nodeId: string,
  run: NodeRunState,
): WorkflowNode[] {
  return nodes.map((node) =>
    node.id === nodeId ? { ...node, data: { ...node.data, run } } : node,
  );
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  name: "Untitled workflow",
  nodes: [],
  edges: [],
  selectedNodeId: null,
  rejection: null,

  setName: (name) => set({ name }),

  onNodesChange: (changes) =>
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) })),

  onEdgesChange: (changes) =>
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) })),

  onConnect: (connection) => {
    const { nodes, edges } = get();
    const result = checkConnection(nodes, edges, connection);

    if (!result.ok) {
      set({ rejection: { reason: result.reason, at: Date.now() } });
      return;
    }

    set({
      edges: addEdge({ ...connection, animated: true }, edges),
      rejection: null,
    });
  },

  addNode: (kind, position) =>
    set((state) => {
      const definition = getDefinition(kind);
      const id = nextNodeId(state.nodes, kind);
      const node: WorkflowNode = {
        id,
        type: "workflow",
        position,
        data: {
          kind,
          label: definition.label,
          config: { ...definition.defaultConfig },
        },
      };
      return { nodes: [...state.nodes, node], selectedNodeId: id };
    }),

  updateNodeConfig: (id, key, value) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } }
          : node,
      ),
    })),

  renameNode: (id, label) =>
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, label } } : node,
      ),
    })),

  deleteNode: (id) =>
    set((state) => ({
      nodes: state.nodes.filter((node) => node.id !== id),
      edges: state.edges.filter((edge) => edge.source !== id && edge.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    })),

  selectNode: (id) => set({ selectedNodeId: id }),

  dismissRejection: () => set({ rejection: null }),

  runPhase: "idle",
  runError: null,
  runOutputs: {},
  runDurationMs: null,

  beginRun: () =>
    set((state) => ({
      runPhase: "running",
      runError: null,
      runOutputs: {},
      runDurationMs: null,
      // Clear the previous run's badges so stale results are never shown as current.
      nodes: state.nodes.map((node) => ({
        ...node,
        data: { ...node.data, run: { status: "idle" as const } },
      })),
    })),

  applyRunEvent: (event) =>
    set((state) => {
      switch (event.type) {
        case "run:start":
          return {};
        case "node:start":
          return { nodes: patchNodeRun(state.nodes, event.nodeId, { status: "running" }) };
        case "node:success":
          return {
            nodes: patchNodeRun(state.nodes, event.nodeId, {
              status: "success",
              durationMs: event.durationMs,
            }),
            runOutputs: { ...state.runOutputs, [event.nodeId]: event.output },
          };
        case "node:error":
          return {
            nodes: patchNodeRun(state.nodes, event.nodeId, {
              status: "error",
              error: event.error,
              durationMs: event.durationMs,
            }),
          };
        case "node:skipped":
          return {
            nodes: patchNodeRun(state.nodes, event.nodeId, { status: "skipped" }),
          };
        case "run:finish":
          return {
            runPhase: event.status,
            runError: event.error ?? null,
            runOutputs: event.outputs,
            runDurationMs: event.durationMs,
          };
      }
    }),

  failRun: (message) => set({ runPhase: "error", runError: message }),

  resetRun: () =>
    set((state) => ({
      runPhase: "idle",
      runError: null,
      runOutputs: {},
      runDurationMs: null,
      nodes: state.nodes.map((node) => ({
        ...node,
        data: { ...node.data, run: undefined },
      })),
    })),

  clear: () =>
    set({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      rejection: null,
      runPhase: "idle",
      runError: null,
      runOutputs: {},
      runDurationMs: null,
    }),

  toDocument: () => {
    const { name, nodes, edges } = get();
    return { version: 1, name, nodes, edges };
  },

  loadDocument: (doc) =>
    set({
      name: doc.name ?? "Untitled workflow",
      nodes: doc.nodes ?? [],
      edges: doc.edges ?? [],
      selectedNodeId: null,
      rejection: null,
    }),
}));
