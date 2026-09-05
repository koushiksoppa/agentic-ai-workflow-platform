"use client";

import { getDefinition, type FieldSpec } from "@/lib/nodes/definitions";
import { useWorkflowStore } from "@/lib/store/workflow-store";
import type { WorkflowNode } from "@/lib/types/workflow";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[13px] text-zinc-900 outline-none transition-colors focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-300";

function Field({
  spec,
  value,
  error,
  onChange,
}: {
  spec: FieldSpec;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
        {spec.label}
      </span>

      {spec.kind === "text" ? (
        <input
          type="text"
          className={inputClass}
          value={String(value ?? "")}
          placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {spec.kind === "textarea" ? (
        <textarea
          rows={spec.rows ?? 3}
          className={`${inputClass} resize-y ${spec.mono ? "font-mono text-xs" : ""}`}
          value={String(value ?? "")}
          placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {spec.kind === "select" ? (
        <select
          className={inputClass}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {spec.kind === "number" ? (
        <input
          type="number"
          className={inputClass}
          value={Number(value ?? 0)}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
      ) : null}

      {error ? (
        <span className="mt-1 block text-[11px] text-rose-600 dark:text-rose-400">{error}</span>
      ) : spec.help ? (
        <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">
          {spec.help}
        </span>
      ) : null}
    </label>
  );
}

export function Inspector({ node }: { node: WorkflowNode | null }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const renameNode = useWorkflowStore((s) => s.renameNode);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);

  if (!node) {
    return (
      <aside className="w-72 shrink-0 border-l border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-[13px] text-zinc-400 dark:text-zinc-500">
          Select a node to edit its configuration.
        </p>
      </aside>
    );
  }

  const definition = getDefinition(node.data.kind);
  const parsed = definition.schema.safeParse(node.data.config);

  // Zod reports issues by path; map the first issue per field to its input.
  const errors = new Map<string, string>();
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "");
      if (key && !errors.has(key)) errors.set(key, issue.message);
    }
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${definition.accent}`} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            {definition.label}
          </span>
        </div>
        <input
          type="text"
          className="mt-1.5 w-full bg-transparent text-sm font-medium text-zinc-900 outline-none dark:text-zinc-50"
          value={node.data.label}
          onChange={(e) => renameNode(node.id, e.target.value)}
        />
        <p className="mt-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-500">{node.id}</p>
      </div>

      <div className="flex flex-col gap-3.5 p-4">
        <p className="text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">
          {definition.description}
        </p>

        {definition.fields.map((spec) => (
          <Field
            key={spec.key}
            spec={spec}
            value={node.data.config[spec.key]}
            error={errors.get(spec.key)}
            onChange={(value) => updateNodeConfig(node.id, spec.key, value)}
          />
        ))}
      </div>

      <div className="mt-auto border-t border-zinc-200 p-4 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => deleteNode(node.id)}
          className="w-full rounded-md border border-rose-200 px-3 py-1.5 text-[13px] text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
        >
          Delete node
        </button>
      </div>
    </aside>
  );
}
