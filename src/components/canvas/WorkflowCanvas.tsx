"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import { Toolbar, type SaveState } from "./Toolbar";
import { LibraryPanel } from "./LibraryPanel";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { RunInputsBar } from "./RunInputsBar";
import { useWorkflowStore } from "@/lib/store/workflow-store";
import { runWorkflow } from "@/lib/store/run-client";
import { saveCurrentWorkflow } from "@/lib/store/library-client";
import { useResolvedTheme } from "@/lib/theme";
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
  const runPhase = useWorkflowStore((s) => s.runPhase);
  const dismissRejection = useWorkflowStore((s) => s.dismissRejection);
  const loadDocument = useWorkflowStore((s) => s.loadDocument);
  const toDocument = useWorkflowStore((s) => s.toDocument);

  const { screenToFlowPosition } = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  // A ref, not state: this only gates the autosave effect and must not itself
  // cause a render.
  const hydrated = useRef(false);
  const runController = useRef<AbortController | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const theme = useResolvedTheme();

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

  const startRun = useCallback(() => {
    runController.current?.abort();
    const controller = new AbortController();
    runController.current = controller;
    void runWorkflow(controller.signal);
  }, []);

  const cancelRun = useCallback(() => {
    runController.current?.abort();
    runController.current = null;
  }, []);

  const save = useCallback(async () => {
    setSaveState("saving");
    try {
      await saveCurrentWorkflow();
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }, []);

  // Clear the transient Save confirmation so the button does not read "Saved"
  // indefinitely. Keyed on the state itself rather than set from the handler.
  useEffect(() => {
    if (saveState !== "saved" && saveState !== "failed") return;
    const timer = setTimeout(() => setSaveState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [saveState]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (event.key === "Escape") {
        setShortcutsOpen(false);
        setLibraryOpen(false);
        if (!typing) selectNode(null);
        return;
      }

      // Everything below would otherwise fight with text entry.
      if (typing) return;

      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;

      switch (event.key.toLowerCase()) {
        case "enter":
          event.preventDefault();
          startRun();
          break;
        case "s":
          // Override the browser's Save Page dialog.
          event.preventDefault();
          void save();
          break;
        case "b":
          event.preventDefault();
          setLibraryOpen((open) => !open);
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startRun, save, selectNode]);

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
        <Toolbar
          problems={problems}
          libraryOpen={libraryOpen}
          onToggleLibrary={() => setLibraryOpen((open) => !open)}
          onShowShortcuts={() => setShortcutsOpen(true)}
          saveState={saveState}
          onSave={() => void save()}
          onRun={startRun}
          onCancel={cancelRun}
        />

        <RunInputsBar disabled={runPhase === "running"} />

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
            colorMode={theme}
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

          {shortcutsOpen ? (
            <ShortcutsOverlay onClose={() => setShortcutsOpen(false)} />
          ) : null}
        </div>
      </div>

      <Inspector node={selectedNode} />

      {libraryOpen ? <LibraryPanel onClose={() => setLibraryOpen(false)} /> : null}
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
