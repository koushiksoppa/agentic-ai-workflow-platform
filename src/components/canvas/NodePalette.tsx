"use client";

import { NODE_LIST, type NodeCategory, type NodeDefinition } from "@/lib/nodes/definitions";
import type { NodeKind } from "@/lib/types/workflow";

export const NODE_DRAG_MIME = "application/x-workflow-node";

const CATEGORY_ORDER: NodeCategory[] = ["Trigger", "Model", "Data", "Logic", "Output"];

function groupByCategory(): [NodeCategory, NodeDefinition[]][] {
  return CATEGORY_ORDER.map((category) => [
    category,
    NODE_LIST.filter((definition) => definition.category === category),
  ] as [NodeCategory, NodeDefinition[]]).filter(([, items]) => items.length > 0);
}

export function NodePalette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Nodes</h2>
        <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
          Drag onto the canvas, or click to add.
        </p>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {groupByCategory().map(([category, definitions]) => (
          <div key={category}>
            <p className="px-1 pb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {category}
            </p>
            <div className="flex flex-col gap-1">
              {definitions.map((definition) => (
                <button
                  key={definition.kind}
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(NODE_DRAG_MIME, definition.kind);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => onAdd(definition.kind)}
                  title={definition.description}
                  className="flex cursor-grab items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-zinc-200 hover:bg-zinc-50 active:cursor-grabbing dark:hover:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${definition.accent}`} />
                  <span className="text-[13px] text-zinc-700 dark:text-zinc-200">
                    {definition.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
