"use client";

import { useRef, useState } from "react";
import { useWorkflowStore } from "@/lib/store/workflow-store";
import { ThemeToggle } from "./ThemeToggle";
import type { GraphProblem } from "@/lib/graph/validation";
import type { WorkflowDocument } from "@/lib/types/workflow";

const buttonClass =
  "rounded-md border border-zinc-300 px-2.5 py-1 text-[12px] text-zinc-700 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800";

const runButtonClass =
  "rounded-md bg-zinc-900 px-3 py-1 text-[12px] font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";

export type SaveState = "idle" | "saving" | "saved" | "failed";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "Save",
  saving: "Saving…",
  saved: "Saved",
  failed: "Save failed",
};

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "workflow"
  );
}

/**
 * Presentational. Run and save live in the canvas so that the buttons here and
 * the keyboard shortcuts drive exactly one implementation.
 */
export function Toolbar({
  problems,
  libraryOpen,
  onToggleLibrary,
  onShowShortcuts,
  saveState,
  onSave,
  onRun,
  onCancel,
}: {
  problems: GraphProblem[];
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  onShowShortcuts: () => void;
  saveState: SaveState;
  onSave: () => void;
  onRun: () => void;
  onCancel: () => void;
}) {
  const name = useWorkflowStore((s) => s.name);
  const setName = useWorkflowStore((s) => s.setName);
  const clear = useWorkflowStore((s) => s.clear);
  const toDocument = useWorkflowStore((s) => s.toDocument);
  const loadDocument = useWorkflowStore((s) => s.loadDocument);
  const nodeCount = useWorkflowStore((s) => s.nodes.length);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const nodes = useWorkflowStore((s) => s.nodes);

  const runPhase = useWorkflowStore((s) => s.runPhase);
  const runError = useWorkflowStore((s) => s.runError);
  const runDurationMs = useWorkflowStore((s) => s.runDurationMs);

  const fileInput = useRef<HTMLInputElement>(null);
  const [showProblems, setShowProblems] = useState(false);

  const isRunning = runPhase === "running";
  const failedNodes = nodes.filter((node) => node.data.run?.status === "error");

  function exportDocument() {
    const blob = new Blob([JSON.stringify(toDocument(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(name)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importDocument(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as WorkflowDocument;
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        throw new Error("missing nodes or edges");
      }
      loadDocument(parsed);
    } catch {
      window.alert("That file is not a valid workflow export.");
    }
  }

  return (
    <div className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-zinc-900 outline-none dark:text-zinc-50"
        aria-label="Workflow name"
      />

      <span className="shrink-0 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
        {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
      </span>

      {runPhase !== "idle" && !isRunning ? (
        <button
          type="button"
          // A failure is clickable: it selects the node that caused it.
          onClick={() => failedNodes[0] && selectNode(failedNodes[0].id)}
          disabled={failedNodes.length === 0}
          title={runError ?? (failedNodes[0] ? "Select the failed node" : undefined)}
          className={`max-w-56 shrink-0 truncate font-mono text-[11px] ${
            failedNodes.length > 0 ? "underline decoration-dotted underline-offset-2" : ""
          } ${
            runPhase === "success"
              ? "text-emerald-600 dark:text-emerald-400"
              : runPhase === "cancelled"
                ? "text-zinc-500 dark:text-zinc-400"
                : "text-rose-600 dark:text-rose-400"
          }`}
        >
          {runError
            ? runError
            : failedNodes.length > 0
              ? `${failedNodes.length} failed`
              : `${runPhase}${runDurationMs !== null ? ` in ${runDurationMs}ms` : ""}`}
        </button>
      ) : null}

      {problems.length > 0 ? (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowProblems((v) => !v)}
            className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[12px] text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          >
            {problems.length} {problems.length === 1 ? "issue" : "issues"}
          </button>
          {showProblems ? (
            <ul className="absolute top-full right-0 z-10 mt-1 w-72 rounded-md border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {problems.map((problem, index) => (
                <li key={index}>
                  <button
                    type="button"
                    disabled={!problem.nodeId}
                    onClick={() => {
                      if (problem.nodeId) selectNode(problem.nodeId);
                      setShowProblems(false);
                    }}
                    className="w-full rounded px-1 py-1 text-left text-[12px] leading-5 text-zinc-600 enabled:hover:bg-zinc-100 disabled:cursor-default dark:text-zinc-300 dark:enabled:hover:bg-zinc-800"
                  >
                    {problem.message}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {isRunning ? (
        <button type="button" className={buttonClass} onClick={onCancel}>
          Cancel
        </button>
      ) : null}

      <button
        type="button"
        className={runButtonClass}
        onClick={onRun}
        disabled={isRunning || nodeCount === 0}
        title="Run the workflow (Ctrl/Cmd + Enter)"
      >
        {isRunning ? "Running…" : "Run"}
      </button>

      <button
        type="button"
        className={buttonClass}
        onClick={onSave}
        disabled={saveState === "saving" || nodeCount === 0}
        title="Save the workflow (Ctrl/Cmd + S)"
      >
        {SAVE_LABEL[saveState]}
      </button>

      <button
        type="button"
        className={`${buttonClass} ${libraryOpen ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
        onClick={onToggleLibrary}
        title="Saved workflows and run history (Ctrl/Cmd + B)"
      >
        Library
      </button>

      <button type="button" className={buttonClass} onClick={exportDocument}>
        Export
      </button>

      <button type="button" className={buttonClass} onClick={() => fileInput.current?.click()}>
        Import
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importDocument(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        className={buttonClass}
        onClick={() => {
          if (nodeCount === 0 || window.confirm("Clear the canvas? This cannot be undone.")) {
            clear();
          }
        }}
      >
        Clear
      </button>

      <ThemeToggle />

      <button
        type="button"
        className={buttonClass}
        onClick={onShowShortcuts}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
      >
        ?
      </button>
    </div>
  );
}
