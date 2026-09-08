import type { RunDetail, RunSummary, SavedWorkflow, WorkflowSummary } from "@/lib/types/api";
import { useWorkflowStore } from "./workflow-store";

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body; the status is all we have.
    }
    throw new Error(message);
  }

  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function fetchWorkflows(): Promise<WorkflowSummary[]> {
  const { workflows } = await request<{ workflows: WorkflowSummary[] }>("/api/workflows");
  return workflows;
}

export async function fetchRuns(): Promise<RunSummary[]> {
  const { runs } = await request<{ runs: RunSummary[] }>("/api/runs?limit=30");
  return runs;
}

/**
 * Saves the canvas. Updates the open workflow when there is one, otherwise
 * creates a new record and adopts its id so later saves overwrite it.
 */
export async function saveCurrentWorkflow(): Promise<SavedWorkflow> {
  const store = useWorkflowStore.getState();
  const document = store.toDocument();
  const existingId = store.workflowId;

  const { workflow } = await request<{ workflow: SavedWorkflow }>(
    existingId ? `/api/workflows/${existingId}` : "/api/workflows",
    {
      method: existingId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(document),
    },
  );

  useWorkflowStore.getState().setWorkflowId(workflow.id);
  return workflow;
}

/** Saves a copy under a new record, leaving the original untouched. */
export async function duplicateCurrentWorkflow(name: string): Promise<SavedWorkflow> {
  const document = { ...useWorkflowStore.getState().toDocument(), name };
  const { workflow } = await request<{ workflow: SavedWorkflow }>("/api/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });

  const store = useWorkflowStore.getState();
  store.setName(name);
  store.setWorkflowId(workflow.id);
  return workflow;
}

export async function openWorkflow(id: string): Promise<void> {
  const { workflow } = await request<{ workflow: SavedWorkflow }>(`/api/workflows/${id}`);
  const store = useWorkflowStore.getState();
  store.resetRun();
  store.loadDocument({ ...workflow.document, name: workflow.name });
  store.setWorkflowId(workflow.id);
}

export async function openRun(id: string): Promise<void> {
  const { run } = await request<{ run: RunDetail }>(`/api/runs/${id}`);
  useWorkflowStore.getState().loadRun(run);
}

export async function removeWorkflow(id: string): Promise<void> {
  await request<void>(`/api/workflows/${id}`, { method: "DELETE" });
  const store = useWorkflowStore.getState();
  // The canvas still holds the graph; it is simply no longer a saved record.
  if (store.workflowId === id) store.setWorkflowId(null);
}
