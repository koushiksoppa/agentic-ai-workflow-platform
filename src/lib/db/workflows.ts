import type { SavedWorkflow, WorkflowSummary } from "@/lib/types/api";
import type { WorkflowDocument } from "@/lib/types/workflow";
import { prisma } from "./client";

export type { SavedWorkflow, WorkflowSummary };

/**
 * SQLite has no JSON type, so documents round-trip through text. A row whose
 * body fails to parse is treated as corrupt rather than crashing a listing.
 */
function parseDocument(name: string, raw: string): WorkflowDocument {
  try {
    const parsed = JSON.parse(raw) as WorkflowDocument;
    return {
      version: 1,
      name,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { version: 1, name, nodes: [], edges: [] };
  }
}

function countNodes(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as WorkflowDocument;
    return Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
  } catch {
    return 0;
  }
}

export async function listWorkflows(): Promise<WorkflowSummary[]> {
  const rows = await prisma.workflow.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, document: true, updatedAt: true },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    nodeCount: countNodes(row.document),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getWorkflow(id: string): Promise<SavedWorkflow | null> {
  const row = await prisma.workflow.findUnique({ where: { id } });
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    nodeCount: countNodes(row.document),
    updatedAt: row.updatedAt.toISOString(),
    document: parseDocument(row.name, row.document),
  };
}

export async function createWorkflow(document: WorkflowDocument): Promise<SavedWorkflow> {
  const row = await prisma.workflow.create({
    data: {
      name: document.name || "Untitled workflow",
      document: JSON.stringify({ nodes: document.nodes, edges: document.edges }),
    },
  });

  return {
    id: row.id,
    name: row.name,
    nodeCount: document.nodes.length,
    updatedAt: row.updatedAt.toISOString(),
    document,
  };
}

export async function updateWorkflow(
  id: string,
  document: WorkflowDocument,
): Promise<SavedWorkflow | null> {
  const exists = await prisma.workflow.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return null;

  const row = await prisma.workflow.update({
    where: { id },
    data: {
      name: document.name || "Untitled workflow",
      document: JSON.stringify({ nodes: document.nodes, edges: document.edges }),
    },
  });

  return {
    id: row.id,
    name: row.name,
    nodeCount: document.nodes.length,
    updatedAt: row.updatedAt.toISOString(),
    document,
  };
}

/** Runs survive: the relation is SetNull, so history outlives the workflow. */
export async function deleteWorkflow(id: string): Promise<boolean> {
  const deleted = await prisma.workflow.deleteMany({ where: { id } });
  return deleted.count > 0;
}
