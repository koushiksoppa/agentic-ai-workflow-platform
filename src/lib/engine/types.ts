import type { NodeConfig } from "@/lib/types/workflow";

export type RunStatus = "success" | "error" | "cancelled";

/**
 * Events emitted as a run progresses. The API route serializes these to SSE
 * and the store folds them back into per-node run state, so the canvas shows
 * progress while the run is still going.
 */
export type RunEvent =
  | { type: "run:start"; runId: string; order: string[] }
  | { type: "node:start"; nodeId: string }
  | { type: "node:success"; nodeId: string; output: unknown; durationMs: number }
  | { type: "node:error"; nodeId: string; error: string; durationMs: number }
  | { type: "node:skipped"; nodeId: string; reason: string }
  | {
      type: "run:finish";
      status: RunStatus;
      durationMs: number;
      outputs: Record<string, unknown>;
      error?: string;
    };

export interface NodeExecutionInput {
  /** Values arriving on live incoming edges, keyed by source node id. */
  bySource: Record<string, unknown>;
  /**
   * The single incoming value when there is exactly one live edge; an array of
   * values when several converge. Undefined for entry nodes.
   */
  value: unknown;
}

export interface ExecutorContext {
  nodeId: string;
  config: NodeConfig;
  input: NodeExecutionInput;
  /** Outputs of every node that has already finished, for template resolution. */
  outputs: Record<string, unknown>;
  signal: AbortSignal;
}

export interface ExecutorResult {
  output: unknown;
  /**
   * Which output handles carry the result. Defaults to every output the node
   * declares. Condition nodes use this to activate exactly one branch.
   */
  activeHandles?: string[];
}

export type NodeExecutor = (ctx: ExecutorContext) => Promise<ExecutorResult>;

/** Thrown by executors to report a clean, user-facing failure. */
export class NodeExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeExecutionError";
  }
}
