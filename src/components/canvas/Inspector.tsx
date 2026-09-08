"use client";

import { getDefinition, type FieldSpec } from "@/lib/nodes/definitions";
import { validateNodeConfig } from "@/lib/nodes/validate";
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
        <span className="mt-1 block text-[11px] text-zinc-400 dark:text-zinc-500">{spec.help}</span>
      ) : null}
    </label>
  );
}

function preview(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function Payload({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  const text = preview(value);

  return (
    <details className="mt-2" open={text.length < 400}>
      <summary className="cursor-pointer text-[11px] text-zinc-500 select-none hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
        {label}
        <span className="ml-1 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          {text.length} chars
        </span>
      </summary>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-zinc-50 px-2 py-1.5 font-mono text-[11px] leading-5 whitespace-pre-wrap text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
        {text}
      </pre>
    </details>
  );
}

/** Last run's outcome for this node: status, timing, error, input, and output. */
function NodeResult({ node }: { node: WorkflowNode }) {
  const output = useWorkflowStore((s) => s.runOutputs[node.id]);
  const input = useWorkflowStore((s) => s.runInputs[node.id]);
  const streamed = useWorkflowStore((s) => s.streaming[node.id]);
  const metadata = useWorkflowStore((s) => s.runMetadata[node.id]);
  const run = node.data.run;

  const branch = typeof metadata?.branch === "string" ? metadata.branch : null;
  const expression = typeof metadata?.expression === "string" ? metadata.expression : null;

  if (!run || run.status === "idle") return null;

  return (
    <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">Last run</span>
        <span
          className={`font-mono text-[11px] ${
            run.status === "success"
              ? "text-emerald-600 dark:text-emerald-400"
              : run.status === "error"
                ? "text-rose-600 dark:text-rose-400"
                : "text-zinc-400 dark:text-zinc-500"
          }`}
        >
          {run.status}
          {run.durationMs !== undefined ? ` · ${run.durationMs}ms` : ""}
          {run.attempts && run.attempts > 1 ? ` · ${run.attempts} attempts` : ""}
        </span>
      </div>

      {run.status === "error" && run.error ? (
        <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-[11px] leading-5 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {run.error}
        </p>
      ) : null}

      {run.status === "running" && run.attempt && run.attempts ? (
        <p className="mt-2 text-[11px] leading-5 text-amber-600 dark:text-amber-400">
          Retrying — attempt {run.attempt} of {run.attempts}.{run.reason ? ` ${run.reason}` : ""}
        </p>
      ) : null}

      {run.status === "skipped" ? (
        <p className="mt-2 text-[11px] leading-5 text-zinc-400 dark:text-zinc-500">
          Skipped — {run.reason ?? "no upstream branch reached this node."}
        </p>
      ) : null}

      {branch ? (
        <div className="mt-2 rounded border border-zinc-200 px-2 py-1.5 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Branch taken:{" "}
            <span
              className={`font-mono font-medium ${
                branch === "true"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {branch}
            </span>
          </p>
          {expression ? (
            <p className="mt-1 font-mono text-[10px] leading-4 break-all text-zinc-400 dark:text-zinc-500">
              {expression}
            </p>
          ) : null}
        </div>
      ) : null}

      <Payload label="Input" value={input} />
      {/* While running, the streamed text is the only output there is. */}
      <Payload label="Output" value={run.status === "running" ? streamed || undefined : output} />
    </div>
  );
}

export function Inspector({ node }: { node: WorkflowNode | null }) {
  const updateNodeConfig = useWorkflowStore((s) => s.updateNodeConfig);
  const renameNode = useWorkflowStore((s) => s.renameNode);
  const deleteNode = useWorkflowStore((s) => s.deleteNode);

  if (!node) {
    return (
      <aside className="w-60 shrink-0 border-l border-zinc-200 bg-white p-4 lg:w-72 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-[13px] text-zinc-400 dark:text-zinc-500">
          Select a node to edit its configuration.
        </p>
      </aside>
    );
  }

  const definition = getDefinition(node.data.kind);

  // Same check the engine runs before executing, so the field-level errors here
  // match exactly what would stop a run.
  const check = validateNodeConfig(node.data.kind, node.data.config);
  const errors = new Map(check.ok ? [] : check.issues.map((issue) => [issue.field, issue.message]));

  return (
    <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-l lg:w-72 border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
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

      <NodeResult node={node} />

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
