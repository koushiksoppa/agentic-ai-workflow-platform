"use client";

import { useMemo, useState } from "react";
import { useWorkflowStore } from "@/lib/store/workflow-store";

interface RunInput {
  name: string;
  /** The node's own configured value, used when nothing is typed here. */
  fallback: string;
  nodeId: string;
}

/**
 * Supplies values for a run without editing the graph.
 *
 * The engine has always accepted per-run overrides keyed by Input node name;
 * this is the surface for them. A field left untouched falls back to the node's
 * configured value, so running with no changes behaves exactly as before.
 */
export function RunInputsBar({ disabled }: { disabled: boolean }) {
  const nodes = useWorkflowStore((s) => s.nodes);
  const inputValues = useWorkflowStore((s) => s.inputValues);
  const setInputValue = useWorkflowStore((s) => s.setInputValue);
  const clearInputValues = useWorkflowStore((s) => s.clearInputValues);
  const selectNode = useWorkflowStore((s) => s.selectNode);
  const [collapsed, setCollapsed] = useState(false);

  const inputs = useMemo(() => {
    const seen = new Set<string>();
    const result: RunInput[] = [];
    for (const node of nodes) {
      if (node.data.kind !== "input") continue;
      const name = String(node.data.config.name ?? "").trim();
      // A duplicate name is reported by the graph lint; show it once here.
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push({ name, fallback: String(node.data.config.value ?? ""), nodeId: node.id });
    }
    return result;
  }, [nodes]);

  if (inputs.length === 0) return null;

  const edited = inputs.filter((input) => input.name in inputValues).length;

  return (
    <div className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          className="text-[11px] font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          {collapsed ? "▸" : "▾"} Run inputs
          <span className="ml-1.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
            {inputs.length}
          </span>
        </button>

        {edited > 0 ? (
          <button
            type="button"
            onClick={clearInputValues}
            className="text-[11px] text-zinc-500 underline decoration-dotted underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Reset {edited} to default{edited === 1 ? "" : "s"}
          </button>
        ) : (
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Using each node&apos;s configured value.
          </span>
        )}
      </div>

      {collapsed ? null : (
        <div className="mt-2 flex flex-wrap gap-3">
          {inputs.map((input) => {
            const overridden = input.name in inputValues;
            return (
              <label key={input.name} className="flex min-w-56 flex-1 flex-col gap-1">
                <span className="flex items-baseline gap-1.5">
                  <button
                    type="button"
                    onClick={() => selectNode(input.nodeId)}
                    title="Select this Input node"
                    className="font-mono text-[11px] text-zinc-600 hover:underline dark:text-zinc-300"
                  >
                    {input.name}
                  </button>
                  {overridden ? (
                    <span className="text-[10px] text-amber-600 dark:text-amber-400">
                      overridden
                    </span>
                  ) : null}
                </span>
                <input
                  type="text"
                  disabled={disabled}
                  value={inputValues[input.name] ?? input.fallback}
                  placeholder={input.fallback || "empty"}
                  onChange={(event) => setInputValue(input.name, event.target.value)}
                  className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-[12px] text-zinc-900 outline-none transition-colors focus:border-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-300"
                />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
