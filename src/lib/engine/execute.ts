import { getDefinition } from "@/lib/nodes/definitions";
import type { NodeConfig, WorkflowDocument, WorkflowEdge } from "@/lib/types/workflow";
import { getExecutor } from "./registry";
import { topologicalOrder } from "./topology";
import type { NodeExecutionInput, RunEvent, RunStatus } from "./types";

export interface RunOptions {
  /** Overrides for Input nodes, keyed by the node's configured name. */
  inputs?: Record<string, string>;
  signal?: AbortSignal;
  runId?: string;
}

/** React Flow omits the handle id when a node has a single handle on that side. */
function sourceHandleOf(edge: WorkflowEdge, kind: Parameters<typeof getDefinition>[0]): string {
  return edge.sourceHandle ?? getDefinition(kind).outputs[0]?.id ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a workflow, yielding an event per state change.
 *
 * A failing node does not abort the run: its descendants are skipped, but
 * independent branches still execute. The run's final status reflects whether
 * anything failed. This keeps one broken HTTP call from hiding results the
 * rest of the graph produced successfully.
 */
export async function* executeWorkflow(
  document: WorkflowDocument,
  options: RunOptions = {},
): AsyncGenerator<RunEvent> {
  const startedAt = Date.now();
  const runId = options.runId ?? crypto.randomUUID();
  const signal = options.signal ?? new AbortController().signal;
  const { nodes, edges } = document;

  const sorted = topologicalOrder(nodes, edges);
  if (!sorted.ok) {
    yield {
      type: "run:finish",
      status: "error",
      durationMs: Date.now() - startedAt,
      outputs: {},
      error: sorted.error,
    };
    return;
  }

  yield { type: "run:start", runId, order: sorted.order };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.target);
    if (list) list.push(edge);
    else incoming.set(edge.target, [edge]);
  }

  const outputs: Record<string, unknown> = {};
  const activeHandles = new Map<string, Set<string>>();
  const unavailable = new Set<string>(); // failed or skipped
  let anyFailed = false;

  for (const nodeId of sorted.order) {
    if (signal.aborted) {
      yield {
        type: "run:finish",
        status: "cancelled",
        durationMs: Date.now() - startedAt,
        outputs,
      };
      return;
    }

    const node = byId.get(nodeId)!;
    const edgesIn = incoming.get(nodeId) ?? [];

    // An edge is live when its source produced a result on that specific handle.
    const live = edgesIn.filter((edge) => {
      if (unavailable.has(edge.source)) return false;
      const sourceNode = byId.get(edge.source);
      if (!sourceNode) return false;
      const handle = sourceHandleOf(edge, sourceNode.data.kind);
      return activeHandles.get(edge.source)?.has(handle) ?? false;
    });

    if (edgesIn.length > 0 && live.length === 0) {
      unavailable.add(nodeId);
      yield {
        type: "node:skipped",
        nodeId,
        reason: "No upstream branch reached this node.",
      };
      continue;
    }

    const bySource: Record<string, unknown> = {};
    for (const edge of live) bySource[edge.source] = outputs[edge.source];
    const values = live.map((edge) => outputs[edge.source]);
    const input: NodeExecutionInput = {
      bySource,
      value: values.length === 0 ? undefined : values.length === 1 ? values[0] : values,
    };

    // Input nodes accept a per-run override, addressed by their configured name.
    let config: NodeConfig = node.data.config;
    if (node.data.kind === "input" && options.inputs) {
      const name = String(config.name ?? "input");
      if (name in options.inputs) config = { ...config, value: options.inputs[name] };
    }

    yield { type: "node:start", nodeId };
    const nodeStartedAt = Date.now();

    try {
      const result = await getExecutor(node.data.kind)({
        nodeId,
        config,
        input,
        outputs,
        signal,
      });

      outputs[nodeId] = result.output;
      activeHandles.set(
        nodeId,
        new Set(result.activeHandles ?? getDefinition(node.data.kind).outputs.map((p) => p.id)),
      );

      yield {
        type: "node:success",
        nodeId,
        output: result.output,
        durationMs: Date.now() - nodeStartedAt,
      };
    } catch (error) {
      anyFailed = true;
      unavailable.add(nodeId);
      yield {
        type: "node:error",
        nodeId,
        error: errorMessage(error),
        durationMs: Date.now() - nodeStartedAt,
      };
    }
  }

  const status: RunStatus = signal.aborted ? "cancelled" : anyFailed ? "error" : "success";
  yield {
    type: "run:finish",
    status,
    durationMs: Date.now() - startedAt,
    outputs,
  };
}

/** Convenience for tests and non-streaming callers. */
export async function runToCompletion(
  document: WorkflowDocument,
  options: RunOptions = {},
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of executeWorkflow(document, options)) events.push(event);
  return events;
}
