"use client";

export interface Shortcut {
  keys: string;
  description: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "Ctrl / ⌘ + Enter", description: "Run the workflow" },
  { keys: "Ctrl / ⌘ + S", description: "Save the workflow" },
  { keys: "Ctrl / ⌘ + B", description: "Toggle the library panel" },
  { keys: "Backspace / Delete", description: "Delete the selected node or edge" },
  { keys: "Escape", description: "Deselect, or close an open panel" },
  { keys: "?", description: "Show this list" },
];

export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-900/40 p-6 backdrop-blur-[1px]"
    >
      <div
        // Clicks inside should not dismiss via the backdrop handler.
        onClick={(event) => event.stopPropagation()}
        className="w-80 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded px-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <dl className="mt-3 flex flex-col gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-baseline justify-between gap-4">
              <dt className="shrink-0 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                {shortcut.keys}
              </dt>
              <dd className="text-right text-[12px] text-zinc-600 dark:text-zinc-400">
                {shortcut.description}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
