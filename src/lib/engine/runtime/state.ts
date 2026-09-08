import type { NodeMetadata, RunEvent, RunStatus } from "../types";

/**
 * Rebuilds the state of a run from its event log, and nothing else.
 *
 * This is the projection that makes the log authoritative. `RunStep` rows hold
 * the same information in mutable form for cheap reads, but they are derived —
 * if the two ever disagree, this function is right.
 *
 * It is also the shared basis for two things that come later: replaying a run
 * to a client that reconnected, and restoring the outputs of an interrupted run
 * so execution can continue from where it stopped.
 *
 * Pure and synchronous: no database, no clock.
 */

export type StepStatus = "running" | "success" | "error" | "skipped";

export interface ReconstructedStep {
  nodeId: string;
  status: StepStatus;
  /**
   * Order in which the node reached a terminal state, starting at 0. Nodes
   * still running have no position yet.
   */
  position: number | null;
  /** The value that arrived on the node's live incoming edges. */
  input?: unknown;
  output?: unknown;
  metadata?: NodeMetadata;
  error?: string;
  durationMs?: number;
}

export interface ReconstructedRun {
  runId: string | null;
  /** "running" until a terminal `run:finish` is seen. */
  status: RunStatus | "running";
  /** Planned execution order, from `run:start`. Empty if the run never began. */
  order: string[];
  /** Terminal steps first, in the order they finished, then anything still running. */
  steps: ReconstructedStep[];
  /** Outputs of every node that succeeded, keyed by node id. */
  outputs: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

export function reconstructRun(events: readonly RunEvent[]): ReconstructedRun {
  const steps = new Map<string, ReconstructedStep>();
  const outputs: Record<string, unknown> = {};

  let runId: string | null = null;
  let order: string[] = [];
  let status: RunStatus | "running" = "running";
  let durationMs: number | undefined;
  let error: string | undefined;
  let position = 0;

  const upsert = (nodeId: string): ReconstructedStep => {
    let step = steps.get(nodeId);
    if (!step) {
      step = { nodeId, status: "running", position: null };
      steps.set(nodeId, step);
    }
    return step;
  };

  for (const event of events) {
    switch (event.type) {
      case "run:start":
        runId = event.runId;
        order = event.order;
        break;

      case "node:start": {
        const step = upsert(event.nodeId);
        // A retry re-enters the node; clear the previous terminal state so the
        // step reflects the attempt that is actually running.
        step.status = "running";
        step.input = event.input;
        break;
      }

      case "node:success": {
        const step = upsert(event.nodeId);
        step.status = "success";
        step.position = position++;
        step.output = event.output;
        step.durationMs = event.durationMs;
        if (event.metadata) step.metadata = event.metadata;
        delete step.error;
        outputs[event.nodeId] = event.output;
        break;
      }

      case "node:error": {
        const step = upsert(event.nodeId);
        step.status = "error";
        step.position = position++;
        step.error = event.error;
        step.durationMs = event.durationMs;
        delete step.output;
        break;
      }

      case "node:skipped": {
        const step = upsert(event.nodeId);
        step.status = "skipped";
        step.position = position++;
        step.metadata = { ...step.metadata, skipReason: event.reason };
        break;
      }

      case "node:retry": {
        // The attempt that failed is history, not state. Recording the count
        // keeps "succeeded on attempt 3" visible after the fact.
        const step = upsert(event.nodeId);
        step.metadata = { ...step.metadata, attempts: event.attempt };
        break;
      }

      case "run:finish":
        status = event.status;
        durationMs = event.durationMs;
        if (event.error) error = event.error;
        // run:finish carries the authoritative output map; a node that
        // succeeded is already in `outputs`, but this covers a log that was
        // truncated mid-run and then finished.
        for (const [nodeId, value] of Object.entries(event.outputs)) {
          outputs[nodeId] = value;
        }
        break;

      case "node:delta":
        // Not persisted, and carries no state a later event does not.
        break;
    }
  }

  const ordered = [...steps.values()].sort((a, b) => {
    if (a.position === null) return b.position === null ? 0 : 1;
    if (b.position === null) return -1;
    return a.position - b.position;
  });

  return {
    runId,
    status,
    order,
    steps: ordered,
    outputs,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}
