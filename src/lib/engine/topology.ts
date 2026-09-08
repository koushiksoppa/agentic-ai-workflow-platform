import type { WorkflowEdge, WorkflowNode } from "@/lib/types/workflow";

export type TopologyResult = { ok: true; order: string[] } | { ok: false; error: string };

/**
 * Kahn's algorithm. The canvas already refuses edges that would close a loop,
 * but an imported file has had no such gate, so the executor re-checks rather
 * than trusting its input.
 */
export function topologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]): TopologyResult {
  const ids = new Set(nodes.map((n) => n.id));

  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      return { ok: false, error: `Edge "${edge.id}" references a node that does not exist.` };
    }
  }

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }
  for (const edge of edges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)!.push(edge.target);
  }

  // Seed in declaration order so a run is deterministic across identical graphs.
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  if (order.length !== nodes.length) {
    const stuck = nodes.filter((n) => !order.includes(n.id)).map((n) => n.id);
    return {
      ok: false,
      error: `The workflow contains a cycle involving: ${stuck.join(", ")}.`,
    };
  }

  return { ok: true, order };
}
