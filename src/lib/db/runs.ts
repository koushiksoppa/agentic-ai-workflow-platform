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
    output?: unknown;
    error?: string | null;
    durationMs?: number | null;
  },
): Promise<void> {
  const output =
    step.output === undefined ? null : JSON.stringify(step.output ?? null);

  // A re-run of the same node id within one run overwrites rather than throws.
  await prisma.runStep.upsert({
    where: { runId_nodeId: { runId, nodeId: step.nodeId } },
    create: {
      runId,
      nodeId: step.nodeId,
      nodeKind: step.nodeKind,
      position: step.position,
      status: step.status,
      output,
      error: step.error ?? null,
      durationMs: step.durationMs ?? null,
    },
    update: {
      status: step.status,
      output,
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
      output: step.output === null ? null : safeParse(step.output),
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
