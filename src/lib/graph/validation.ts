import type { Connection } from "@xyflow/react";
import { getDefinition, getPort } from "@/lib/nodes/definitions";
import { describeConfigIssues, validateNodeConfig } from "@/lib/nodes/validate";
import { isPortCompatible, type WorkflowEdge, type WorkflowNode } from "@/lib/types/workflow";

export type ConnectionCheck = { ok: true } | { ok: false; reason: string };

/**
 * Walks forward from `target` to see whether `source` is already reachable.
 * If it is, adding source -> target would close a loop, and the graph would
 * no longer be a DAG the executor can topologically order.
 */
export function wouldCreateCycle(edges: WorkflowEdge[], source: string, target: string): boolean {
  if (source === target) return true;

  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source);
    if (list) list.push(edge.target);
    else outgoing.set(edge.source, [edge.target]);
  }

  const seen = new Set<string>();
  const stack = [target];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === source) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(outgoing.get(current) ?? []));
  }

  return false;
}

/**
 * Full validity check for a proposed edge. Returns a human-readable reason on
 * rejection so the UI can explain why a drag was refused rather than silently
 * dropping it.
 */
export function checkConnection(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  connection: Connection,
): ConnectionCheck {
  const { source, target, sourceHandle, targetHandle } = connection;

  if (!source || !target) {
    return { ok: false, reason: "Incomplete connection." };
  }
  if (source === target) {
    return { ok: false, reason: "A node cannot connect to itself." };
  }

  const sourceNode = nodes.find((n) => n.id === source);
  const targetNode = nodes.find((n) => n.id === target);
  if (!sourceNode || !targetNode) {
    return { ok: false, reason: "One end of the connection no longer exists." };
  }

  const outPort = getPort(sourceNode.data.kind, "outputs", sourceHandle);
  const inPort = getPort(targetNode.data.kind, "inputs", targetHandle);
  if (!outPort) return { ok: false, reason: "That node has no output to connect from." };
  if (!inPort) return { ok: false, reason: "That node has no input to connect to." };

  const duplicate = edges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      (e.sourceHandle ?? null) === (sourceHandle ?? null) &&
      (e.targetHandle ?? null) === (targetHandle ?? null),
  );
  if (duplicate) {
    return { ok: false, reason: "These ports are already connected." };
  }

  if (!inPort.multiple) {
    const occupied = edges.some(
      (e) => e.target === target && (e.targetHandle ?? null) === (targetHandle ?? null),
    );
    if (occupied) {
      return {
        ok: false,
        reason: `The ${inPort.label} input accepts only one connection.`,
      };
    }
  }

  if (!isPortCompatible(outPort.type, inPort.type)) {
    return {
      ok: false,
      reason: `Type mismatch: ${outPort.type} output cannot feed a ${inPort.type} input.`,
    };
  }

  if (wouldCreateCycle(edges, source, target)) {
    return { ok: false, reason: "That would create a cycle. Workflows must be acyclic." };
  }

  return { ok: true };
}

export interface GraphProblem {
  nodeId?: string;
  message: string;
}

/**
 * Whole-graph lint, surfaced in the toolbar. These are warnings about an
 * unrunnable graph, not connection-time errors.
 */
export function validateGraph(nodes: WorkflowNode[], edges: WorkflowEdge[]): GraphProblem[] {
  const problems: GraphProblem[] = [];

  if (nodes.length === 0) {
    return [{ message: "The canvas is empty. Add a node to begin." }];
  }

  if (!nodes.some((n) => n.data.kind === "input")) {
    problems.push({ message: "No Input node — the workflow has no entry point." });
  }
  if (!nodes.some((n) => n.data.kind === "output")) {
    problems.push({ message: "No Output node — nothing captures a result." });
  }

  // Run-time overrides are addressed by name, so duplicates are ambiguous.
  const inputNames = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.data.kind !== "input") continue;
    const name = String(node.data.config.name ?? "").trim();
    if (!name) continue;
    inputNames.set(name, [...(inputNames.get(name) ?? []), node.id]);
  }
  for (const [name, ids] of inputNames) {
    if (ids.length > 1) {
      problems.push({
        nodeId: ids[1],
        message: `More than one Input node is named "${name}". Run inputs are addressed by name, so give each a distinct one.`,
      });
    }
  }

  for (const node of nodes) {
    const connectedIn = edges.some((e) => e.target === node.id);
    const connectedOut = edges.some((e) => e.source === node.id);
    if (!connectedIn && !connectedOut && nodes.length > 1) {
      problems.push({
        nodeId: node.id,
        message: `"${node.data.label}" is not connected to anything.`,
      });
    }

    // The engine refuses to run these; warn before the user starts a run.
    const config = validateNodeConfig(node.data.kind, node.data.config);
    if (!config.ok) {
      problems.push({
        nodeId: node.id,
        message: `${getDefinition(node.data.kind).label} "${node.data.label}" — ${describeConfigIssues(config.issues)}.`,
      });
    }
  }

  return problems;
}
