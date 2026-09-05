"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getDefinition } from "@/lib/nodes/definitions";
import type { NodeRunStatus, PortSpec, WorkflowNode } from "@/lib/types/workflow";

const STATUS_RING: Record<NodeRunStatus, string> = {
  idle: "",
  running: "ring-2 ring-sky-400 animate-pulse",
  success: "ring-2 ring-emerald-400",
  error: "ring-2 ring-rose-500",
  skipped: "opacity-50",
};

const PORT_TONE: Record<PortSpec["type"], string> = {
  text: "!bg-emerald-500",
  json: "!bg-sky-500",
  boolean: "!bg-rose-500",
  any: "!bg-zinc-400",
};

function PortRow({
  port,
  side,
}: {
  port: PortSpec;
  side: "input" | "output";
}) {
  const isInput = side === "input";
  return (
    <div
      className={`relative flex items-center gap-1.5 py-1 text-[11px] text-zinc-500 dark:text-zinc-400 ${
        isInput ? "justify-start" : "justify-end"
      }`}
    >
      <Handle
        type={isInput ? "target" : "source"}
        position={isInput ? Position.Left : Position.Right}
        id={port.id}
        className={`!h-2.5 !w-2.5 !border-2 !border-white dark:!border-zinc-900 ${
          PORT_TONE[port.type]
        }`}
        style={{ [isInput ? "left" : "right"]: -13, top: "50%" }}
      />
      <span>{port.label}</span>
    </div>
  );
}

function WorkflowNodeCardImpl({ data, selected }: NodeProps<WorkflowNode>) {
  const definition = getDefinition(data.kind);
  const status = data.run?.status ?? "idle";

  return (
    <div
      className={`w-60 rounded-lg border bg-white shadow-sm transition-shadow dark:bg-zinc-900 ${
        selected
          ? "border-zinc-900 shadow-md dark:border-zinc-100"
          : "border-zinc-200 dark:border-zinc-700"
      } ${STATUS_RING[status]}`}
    >
      <div className={`h-1 rounded-t-lg ${definition.accent}`} />

      <div className="px-3 pt-2.5">
        <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {definition.label}
        </p>
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {data.label}
        </p>
        <p
          className="mt-1 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400"
          title={definition.summary(data.config)}
        >
          {definition.summary(data.config)}
        </p>
      </div>

      {data.run?.status === "error" && data.run.error ? (
        <p className="mx-3 mt-2 truncate rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700 dark:bg-rose-950 dark:text-rose-300">
          {data.run.error}
        </p>
      ) : null}

      <div className="mt-1.5 flex justify-between gap-3 border-t border-zinc-100 px-3 py-1 dark:border-zinc-800">
        <div className="flex flex-col">
          {definition.inputs.map((port) => (
            <PortRow key={port.id} port={port} side="input" />
          ))}
        </div>
        <div className="flex flex-col">
          {definition.outputs.map((port) => (
            <PortRow key={port.id} port={port} side="output" />
          ))}
        </div>
      </div>
    </div>
  );
}

export const WorkflowNodeCard = memo(WorkflowNodeCardImpl);
