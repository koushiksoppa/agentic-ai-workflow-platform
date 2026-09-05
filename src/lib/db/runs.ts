import type { RunStatus } from "@/lib/engine/types";
import type { RunDetail, RunStepRecord, RunSummary } from "@/lib/types/api";
import type { WorkflowDocument } from "@/lib/types/workflow";
import { prisma } from "./client";

export type { RunDetail, RunStepRecord, RunSummary };

export async function createRun(input: {
  workflowId: string | null;
  workflowName: string;
  document: WorkflowDocument;
}): Promise<string> {
  const row = await prisma.run.create({
    data: {
      // Only link a workflow that still exists; a stale id would violate the FK.
      workflowId: input.workflowId ?? null,
      workflowName: input.workflowName,
      document: JSON.stringify({
        nodes: input.document.nodes,
        edges: input.document.edges,
      }),
      status: "running",
    },
    select: { id: true },
  });
  return row.id;
}

export async function recordStep(
  runId: string,
  step: {
    nodeId: string;
    nodeKind: string;
    position: number;
    status: string;
    input?: unknown;
    output?: unknown;
    /** Serialized as-is, like input and output. */
    metadata?: unknown;
    error?: string | null;
    durationMs?: number | null;
  },
): Promise<void> {
  const output =
    step.output === undefined ? null : JSON.stringify(step.output ?? null);
  const input = step.input === undefined ? null : JSON.stringify(step.input ?? null);
  const metadata =
    step.metadata === undefined || step.metadata === null
      ? null
      : JSON.stringify(step.metadata);

  // A re-run of the same node id within one run overwrites rather than throws.
  await prisma.runStep.upsert({
    where: { runId_nodeId: { runId, nodeId: step.nodeId } },
    create: {
      runId,
      nodeId: step.nodeId,
      nodeKind: step.nodeKind,
      position: step.position,
      status: step.status,
      input,
      output,
      metadata,
      error: step.error ?? null,
      durationMs: step.durationMs ?? null,
    },
    update: {
      status: step.status,
      input,
      output,
      metadata,
      error: step.error ?? null,
      durationMs: step.durationMs ?? null,
      position: step.position,
    },
  });
}

export async function finishRun(
  runId: string,
  result: { status: RunStatus; error?: string | null; durationMs: number },
): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: {
      status: result.status,
      error: result.error ?? null,
      durationMs: result.durationMs,
      finishedAt: new Date(),
    },
  });
}

/**
 * Runs left at "running" by a process that died mid-execution.
 *
 * The run route closes its own records even on a disconnect, but nothing can
 * run in-process after a crash or a restart, so those rows would stay
 * "running" forever. Reconciling lazily on read avoids needing a background
 * job for what is a rare case.
 */
export const STALE_RUN_MS = 5 * 60 * 1000;

let lastReconciledAt = 0;

export async function reconcileStaleRuns(
  staleAfterMs: number = STALE_RUN_MS,
  now: number = Date.now(),
): Promise<number> {
  const { count } = await prisma.run.updateMany({
    where: { status: "running", startedAt: { lt: new Date(now - staleAfterMs) } },
    data: {
      status: "cancelled",
      error: "Interrupted — the server stopped before this run finished.",
      finishedAt: new Date(now),
    },
  });
  return count;
}

/** Throttled wrapper, so a read-heavy page does not write on every request. */
export async function reconcileStaleRunsThrottled(intervalMs = 30_000): Promise<void> {
  const now = Date.now();
  if (now - lastReconciledAt < intervalMs) return;
  lastReconciledAt = now;
  try {
    await reconcileStaleRuns();
  } catch (error) {
    console.error("Could not reconcile stale runs:", error);
  }
}

export async function listRuns(options: { workflowId?: string; limit?: number } = {}) {
  const rows = await prisma.run.findMany({
    where: options.workflowId ? { workflowId: options.workflowId } : undefined,
    orderBy: { startedAt: "desc" },
    take: Math.min(options.limit ?? 25, 100),
    select: {
      id: true,
      workflowId: true,
      workflowName: true,
      status: true,
      error: true,
      startedAt: true,
      durationMs: true,
      _count: { select: { steps: true } },
    },
  });

  return rows.map(
    (row): RunSummary => ({
      id: row.id,
      workflowId: row.workflowId,
      workflowName: row.workflowName,
      status: row.status,
      error: row.error,
      startedAt: row.startedAt.toISOString(),
      durationMs: row.durationMs,
      stepCount: row._count.steps,
    }),
  );
}

export async function getRun(id: string): Promise<RunDetail | null> {
  const row = await prisma.run.findUnique({
    where: { id },
    include: { steps: { orderBy: { position: "asc" } } },
  });
  if (!row) return null;

  let document: WorkflowDocument;
  try {
    const parsed = JSON.parse(row.document) as WorkflowDocument;
    document = {
      version: 1,
      name: row.workflowName,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    document = { version: 1, name: row.workflowName, nodes: [], edges: [] };
  }

  return {
    id: row.id,
    workflowId: row.workflowId,
    workflowName: row.workflowName,
    status: row.status,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    durationMs: row.durationMs,
    stepCount: row.steps.length,
    document,
    steps: row.steps.map((step) => ({
      nodeId: step.nodeId,
      nodeKind: step.nodeKind,
      position: step.position,
      status: step.status,
      input: step.input === null ? null : safeParse(step.input),
      output: step.output === null ? null : safeParse(step.output),
      metadata:
        step.metadata === null
          ? null
          : (safeParse(step.metadata) as Record<string, unknown> | null),
      error: step.error,
      durationMs: step.durationMs,
    })),
  };
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
