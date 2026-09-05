import type { WorkflowDocument } from "./workflow";

/**
 * Shapes exchanged over HTTP.
 *
 * These live apart from the database layer on purpose: client components import
 * them, and importing from `lib/db` would drag Prisma into the browser bundle.
 */

export interface WorkflowSummary {
  id: string;
  name: string;
  nodeCount: number;
  updatedAt: string;
}

export interface SavedWorkflow extends WorkflowSummary {
  document: WorkflowDocument;
}

export interface RunSummary {
  id: string;
  workflowId: string | null;
  workflowName: string;
  status: string;
  error: string | null;
  startedAt: string;
  durationMs: number | null;
  stepCount: number;
}

export interface RunStepRecord {
  nodeId: string;
  nodeKind: string;
  position: number;
  status: string;
  output: unknown;
  error: string | null;
  durationMs: number | null;
}

export interface RunDetail extends RunSummary {
  /** The graph exactly as executed, so a replay shows what actually ran. */
  document: WorkflowDocument;
  steps: RunStepRecord[];
}
