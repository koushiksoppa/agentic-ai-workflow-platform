import { getDefinition } from "@/lib/nodes/definitions";
import { describeConfigIssues, validateNodeConfig } from "@/lib/nodes/validate";
import { resolveRetries, resolveTimeout, retryDelay } from "@/lib/nodes/execution-config";
import type {
  NodeConfig,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/types/workflow";
import { getExecutor } from "./registry";
import { topologicalOrder } from "./topology";
import { NodeExecutionError, isRetryable } from "./types";
import type { ExecutorResult, NodeExecutionInput, RunEvent, RunStatus } from "./types";

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
 * Explains why no incoming edge was live.
 *
 * "No upstream branch reached this node" is true but useless when debugging;
 * naming the condition and the branch it took is what makes a pruned branch
 * understandable in the inspector.
 */
function explainSkip(
  edgesIn: WorkflowEdge[],
  byId: Map<string, WorkflowNode>,
  activeHandles: Map<string, Set<string>>,
  unavailable: Set<string>,
): string {
  for (const edge of edgesIn) {
    const source = byId.get(edge.source);
    if (!source) continue;

    const label = source.data.label || edge.source;

    if (unavailable.has(edge.source)) {
      return `"${label}" did not produce a result.`;
    }

    const active = activeHandles.get(edge.source);
    if (!active) continue;

    const handle = sourceHandleOf(edge, source.data.kind);
    if (!active.has(handle)) {
      if (source.data.kind === "condition") {
        const taken = [...active][0] ?? "the other";
        return `"${label}" took the ${taken} branch.`;
      }
      return `"${label}" did not produce output on "${handle}".`;
    }
  }

  return "No upstream branch reached this node.";
}

/** Waits, but wakes immediately if the run is cancelled. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Runs an executor while forwarding whatever it streams.
 *
 * An executor is a plain promise, so it cannot yield. It instead pushes
 * partial text through `onDelta`; this drains that queue between awaits, so
 * deltas reach the client *during* the call rather than all at once after it.
 */
async function* runWithDeltas(
  nodeId: string,
  start: (onDelta: (text: string) => void) => Promise<ExecutorResult>,
): AsyncGenerator<RunEvent, ExecutorResult> {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let finished = false;

  const running = start((text) => {
    queue.push(text);
    wake?.();
  });

  // Settle into a value so a rejection cannot go unhandled while we drain.
  const settled = running.then(
    (value) => {
      finished = true;
      wake?.();
      return { ok: true as const, value };
    },
    (error: unknown) => {
      finished = true;
      wake?.();
      return { ok: false as const, error };
    },
  );

  for (;;) {
    while (queue.length > 0) {
      yield { type: "node:delta", nodeId, text: queue.shift()! };
    }
    if (finished) break;
    await new Promise<void>((resolve) => {
      wake = () => {
        wake = null;
        resolve();
      };
    });
  }

  const outcome = await settled;
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
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
        reason: explainSkip(edgesIn, byId, activeHandles, unavailable),
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

    yield { type: "node:start", nodeId, input: input.value };
    const nodeStartedAt = Date.now();

    const attempts = resolveRetries(config.retries) + 1;
    const timeoutMs = resolveTimeout(config.timeoutMs);

    try {
      // Enforced here rather than at save time: a workflow may legitimately be
      // saved half-configured, but it must not execute that way.
      const check = validateNodeConfig(node.data.kind, config);
      if (!check.ok) {
        throw new NodeExecutionError(describeConfigIssues(check.issues));
      }

      let result: ExecutorResult | undefined;
      let attempt = 0;

      for (;;) {
        attempt += 1;

        // A per-node deadline on top of the run signal. Executors that honour
        // the signal stop immediately; the run moves on regardless.
        const nodeTimeout = AbortSignal.timeout(timeoutMs);
        const nodeSignal = AbortSignal.any([signal, nodeTimeout]);

        try {
          result = yield* runWithDeltas(nodeId, (onDelta) =>
            getExecutor(node.data.kind)({
              nodeId,
              config,
              input,
              outputs,
              signal: nodeSignal,
              onDelta,
            }),
          );
          break;
        } catch (raw) {
          // A cancelled run must never be retried.
          if (signal.aborted) throw raw;

          // A node that ran out of time reports the deadline rather than
          // whatever the executor happened to throw on abort. It stays
          // retryable, so it still flows through the decision below rather
          // than short-circuiting out of the loop.
          const error = nodeTimeout.aborted
            ? new NodeExecutionError(`Timed out after ${timeoutMs / 1000}s.`, {
                retryable: true,
              })
            : raw;

          if (attempt >= attempts || !isRetryable(error)) throw error;

          const wait = retryDelay(attempt);
          yield {
            type: "node:retry",
            nodeId,
            attempt,
            attempts,
            delayMs: wait,
            error: errorMessage(error),
          };
          await delay(wait, signal);
          if (signal.aborted) throw error;
        }
      }

      const metadata = attempt > 1 ? { ...result.metadata, attempts: attempt } : result.metadata;

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
        ...(metadata ? { metadata } : {}),
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
