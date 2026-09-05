"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { NodePalette, NODE_DRAG_MIME } from "./NodePalette";
import { Inspector } from "./Inspector";
import { WorkflowNodeCard } from "./WorkflowNodeCard";
import { Toolbar } from "./Toolbar";
import { useWorkflowStore } from "@/lib/store/workflow-store";
import { validateGraph } from "@/lib/graph/validation";
import { getDefinition } from "@/lib/nodes/definitions";
import type { NodeKind, WorkflowDocument } from "@/lib/types/workflow";

/** Defined at module scope — React Flow warns if this identity changes per render. */
const nodeTypes: NodeTypes = { workflow: WorkflowNodeCard };

const DRAFT_KEY = "workflow:draft";

function CanvasInner() {
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const addNode = useWorkflowStore((s) => s.addNode);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const rejection = useWorkflowStore((s) => s.rejection);
  const dismissRejection = useWorkflowStore((s) => s.dismissRejection);
  const loadDocument = useWorkflowStore((s) => s.loadDocument);
  const toDocument = useWorkflowStore((s) => s.toDocument);

  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  // A ref, not state: this only gates the autosave effect and must not itself
  // cause a render.
  const hydrated = useRef(false);

  // Restore the draft once, client-side, so SSR markup and first paint agree.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) loadDocument(JSON.parse(saved) as WorkflowDocument);
    } catch {
      // A corrupt draft should not block the editor; start empty instead.
    }
    hydrated.current = true;
  }, [loadDocument]);

  // Autosave, debounced. The restore effect above runs first on mount, and the
  // debounce means the render it triggers cancels this pass's timer before it
  // can write the pre-restore empty graph over a saved draft.
  useEffect(() => {
    if (!hydrated.current) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(toDocument()));
      } catch {
        // Quota or private-mode failures are non-fatal.
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [nodes, edges, toDocument]);

  // Auto-dismiss the rejection toast.
  useEffect(() => {
    if (!rejection) return;
    const timer = setTimeout(dismissRejection, 4000);
    return () => clearTimeout(timer);
  }, [rejection, dismissRejection]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData(NODE_DRAG_MIME) as NodeKind;
      if (!kind || !getDefinition(kind)) return;
      addNode(kind, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    },
    [addNode, screenToFlowPosition],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  /** Click-to-add drops the node in the middle of the current viewport. */
  const addToCenter = useCallback(
    (kind: NodeKind) => {
      const rect = wrapper.current?.getBoundingClientRect();
      const position = rect
        ? screenToFlowPosition({
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
          })
        : { x: 0, y: 0 };
      addNode(kind, position);
    },
    [addNode, screenToFlowPosition],
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const problems = validateGraph(nodes, edges);

  return (
    <div className="flex flex-1 overflow-hidden">
      <NodePalette onAdd={addToCenter} />

      <div className="relative flex flex-1 flex-col">
        <Toolbar problems={problems} />

        <div ref={wrapper} className="relative flex-1" onDrop={onDrop} onDragOver={onDragOver}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => selectNode(node.id)}
            onPaneClick={() => selectNode(null)}
            deleteKeyCode={["Backspace", "Delete"]}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-zinc-100 dark:!bg-zinc-800" />
          </ReactFlow>

          {nodes.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="text-[13px] text-zinc-400 dark:text-zinc-500">
                Drag a node from the left to start building.
              </p>
            </div>
          ) : null}

          {rejection ? (
            <div
              role="alert"
              className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700 shadow-sm dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
            >
              {rejection.reason}
            </div>
          ) : null}
        </div>
      </div>

      <Inspector node={selectedNode} />
    </div>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  );
}
