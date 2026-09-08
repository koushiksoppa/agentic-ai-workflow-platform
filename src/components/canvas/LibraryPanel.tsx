"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchRuns,
  fetchWorkflows,
  openRun,
  openWorkflow,
  removeWorkflow,
} from "@/lib/store/library-client";
import { useWorkflowStore } from "@/lib/store/workflow-store";
import type { RunSummary, WorkflowSummary } from "@/lib/types/api";

type Tab = "workflows" | "runs";

const STATUS_TONE: Record<string, string> = {
  success: "text-emerald-600 dark:text-emerald-400",
  error: "text-rose-600 dark:text-rose-400",
  cancelled: "text-zinc-500 dark:text-zinc-400",
  running: "text-sky-600 dark:text-sky-400",
};

function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export function LibraryPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("workflows");
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const openWorkflowId = useWorkflowStore((s) => s.workflowId);

  // Bumped to re-run the loader; the fetch lives inside the effect so nothing
  // reaches setState until after the await, and an unmount mid-flight is
  // ignored rather than warning about state on a dead component.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [w, r] = await Promise.all([fetchWorkflows(), fetchRuns()]);
        if (cancelled) return;
        setWorkflows(w);
        setRuns(r);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  async function act(action: () => Promise<void>) {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div className="flex gap-1">
          {(["workflows", "runs"] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`rounded-md px-2 py-1 text-[12px] capitalize transition-colors ${
                tab === value
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={refresh}
            className="rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close library"
            className="rounded-md px-2 py-1 text-[12px] text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>
      </div>

      {error ? (
        <p className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-1 py-2 text-[12px] text-zinc-400 dark:text-zinc-500">Loading…</p>
        ) : null}

        {!loading && tab === "workflows" ? (
          workflows.length === 0 ? (
            <p className="px-1 py-2 text-[12px] leading-5 text-zinc-400 dark:text-zinc-500">
              Nothing saved yet. Use Save in the toolbar to store the current canvas.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {workflows.map((workflow) => (
                <li
                  key={workflow.id}
                  className={`group rounded-md border px-2 py-1.5 transition-colors ${
                    workflow.id === openWorkflowId
                      ? "border-zinc-900 dark:border-zinc-100"
                      : "border-transparent hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void act(() => openWorkflow(workflow.id))}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[13px] text-zinc-800 dark:text-zinc-100">
                        {workflow.name}
                      </span>
                      <span className="block font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                        {workflow.nodeCount} nodes · {relativeTime(workflow.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${workflow.name}`}
                      onClick={() =>
                        void act(async () => {
                          if (
                            !window.confirm(`Delete "${workflow.name}"? Its run history is kept.`)
                          ) {
                            return;
                          }
                          await removeWorkflow(workflow.id);
                          refresh();
                        })
                      }
                      className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100 dark:hover:bg-rose-950"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {!loading && tab === "runs" ? (
          runs.length === 0 ? (
            <p className="px-1 py-2 text-[12px] leading-5 text-zinc-400 dark:text-zinc-500">
              No runs recorded yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {runs.map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => void act(() => openRun(run.id))}
                    title={run.error ?? "Open this run's snapshot and results"}
                    className="w-full rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800 dark:text-zinc-100">
                        {run.workflowName}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[11px] ${
                          STATUS_TONE[run.status] ?? "text-zinc-400"
                        }`}
                      >
                        {run.status}
                      </span>
                    </span>
                    <span className="block font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                      {run.stepCount} steps
                      {run.durationMs !== null ? ` · ${run.durationMs}ms` : ""} ·{" "}
                      {relativeTime(run.startedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>

      <p className="border-t border-zinc-200 px-3 py-2 text-[11px] leading-4 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
        Opening a run restores the graph as it ran, with each node&apos;s recorded result.
      </p>
    </aside>
  );
}
