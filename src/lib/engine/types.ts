import type { NodeConfig } from "@/lib/types/workflow";

export type RunStatus = "success" | "error" | "cancelled";

/**
 * Side-channel for facts about an execution that are not its output.
 *
 * A Condition passes its input through unchanged, so its decision cannot live
 * in the output without changing what downstream nodes receive. This keeps the
 * decision recordable without altering the data flow.
 */
export interface NodeMetadata {
  /** Condition nodes: the branch that was activated. */
  branch?: "true" | "false";
  /** The expression that produced the decision, for the inspector. */
  expression?: string;
  /** Skipped nodes: why the run never reached them. */
  skipReason?: string;
}

/**
 * Events emitted as a run progresses. The API route serializes these to SSE
 * and the store folds them back into per-node run state, so the canvas shows
 * progress while the run is still going.
 */
export type RunEvent =
  | { type: "run:start"; runId: string; order: string[] }
  | { type: "node:start"; nodeId: string; input: unknown }
  | { type: "node:delta"; nodeId: string; text: string }
  | {
      type: "node:success";
      nodeId: string;
      output: unknown;
      durationMs: number;
      /** Execution facts that are not the output — e.g. the branch taken. */
      metadata?: NodeMetadata;
    }
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
  /**
   * Streams partial output while the node is still running. The executor
   * forwards these as `node:delta` events, so the canvas shows text arriving
   * rather than a spinner.
   */
  onDelta?: (text: string) => void;
}

export interface ExecutorResult {
  output: unknown;
  /** Recorded alongside the result; see NodeMetadata. */
  metadata?: NodeMetadata;
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
