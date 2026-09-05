import { describe, expect, it } from "vitest";
import { checkConnection, validateGraph, wouldCreateCycle } from "./validation";
import { getDefinition } from "@/lib/nodes/definitions";
import type { NodeKind, WorkflowEdge, WorkflowNode } from "@/lib/types/workflow";

function node(id: string, kind: NodeKind): WorkflowNode {
  return {
    id,
    type: "workflow",
    position: { x: 0, y: 0 },
    data: {
      kind,
      label: getDefinition(kind).label,
      config: { ...getDefinition(kind).defaultConfig },
    },
  };
}

function edge(source: string, target: string, sourceHandle?: string, targetHandle?: string): WorkflowEdge {
  return {
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: sourceHandle ?? null,
    targetHandle: targetHandle ?? null,
  };
}

describe("wouldCreateCycle", () => {
  it("treats a self-connection as a cycle", () => {
    expect(wouldCreateCycle([], "a", "a")).toBe(true);
  });

  it("allows an edge that keeps the graph acyclic", () => {
    expect(wouldCreateCycle([edge("a", "b")], "b", "c")).toBe(false);
  });

  it("detects a direct back-edge", () => {
    expect(wouldCreateCycle([edge("a", "b")], "b", "a")).toBe(true);
  });

  it("detects a cycle across a longer path", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
    expect(wouldCreateCycle(edges, "d", "a")).toBe(true);
  });

  it("does not mistake a diamond for a cycle", () => {
    // a -> b -> d, a -> c; adding c -> d converges but stays acyclic.
    const edges = [edge("a", "b"), edge("b", "d"), edge("a", "c")];
    expect(wouldCreateCycle(edges, "c", "d")).toBe(false);
  });
});

describe("checkConnection", () => {
  const nodes = [
    node("input_1", "input"),
    node("llm_1", "llm"),
    node("output_1", "output"),
    node("input_2", "input"),
  ];

  it("accepts a valid connection", () => {
    const result = checkConnection(nodes, [], {
      source: "input_1",
      target: "llm_1",
      sourceHandle: "value",
      targetHandle: "in",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a node connecting to itself", () => {
    const result = checkConnection(nodes, [], {
      source: "llm_1",
      target: "llm_1",
      sourceHandle: "text",
      targetHandle: "in",
    });
    expect(result).toEqual({ ok: false, reason: "A node cannot connect to itself." });
  });

  it("rejects a duplicate edge between the same ports", () => {
    const existing = [edge("input_1", "llm_1", "value", "in")];
    const result = checkConnection(nodes, existing, {
      source: "input_1",
      target: "llm_1",
      sourceHandle: "value",
      targetHandle: "in",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/already connected/);
  });

  it("allows fan-in on a port marked multiple", () => {
    // The model node's context port accepts many inbound edges.
    const existing = [edge("input_1", "llm_1", "value", "in")];
    const result = checkConnection(nodes, existing, {
      source: "input_2",
      target: "llm_1",
      sourceHandle: "value",
      targetHandle: "in",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a second edge into a single-capacity port", () => {
    // The output node's value port is not marked multiple.
    const existing = [edge("llm_1", "output_1", "text", "in")];
    const result = checkConnection(nodes, existing, {
      source: "input_1",
      target: "output_1",
      sourceHandle: "value",
      targetHandle: "in",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/only one connection/);
  });

  it("rejects an edge that would close a loop", () => {
    const cyclic = [node("llm_1", "llm"), node("transform_1", "transform")];
    const existing = [edge("llm_1", "transform_1", "text", "in")];
    const result = checkConnection(cyclic, existing, {
      source: "transform_1",
      target: "llm_1",
      sourceHandle: "out",
      targetHandle: "in",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/cycle/);
  });

  it("rejects a connection referencing a missing node", () => {
    const result = checkConnection(nodes, [], {
      source: "ghost",
      target: "llm_1",
      sourceHandle: "value",
      targetHandle: "in",
    });
    expect(result.ok).toBe(false);
  });
});

describe("validateGraph", () => {
  it("reports an empty canvas", () => {
    expect(validateGraph([], [])).toEqual([
      { message: "The canvas is empty. Add a node to begin." },
    ]);
  });

  it("flags a missing entry point and a missing result", () => {
    const problems = validateGraph([node("llm_1", "llm")], []);
    const messages = problems.map((p) => p.message);
    expect(messages).toContain("No Input node — the workflow has no entry point.");
    expect(messages).toContain("No Output node — nothing captures a result.");
  });

  it("flags an orphaned node", () => {
    const nodes = [node("input_1", "input"), node("output_1", "output"), node("llm_1", "llm")];
    const edges = [edge("input_1", "output_1", "value", "in")];
    const problems = validateGraph(nodes, edges);
    expect(problems.some((p) => p.nodeId === "llm_1")).toBe(true);
  });

  it("passes a complete, connected graph", () => {
    const nodes = [node("input_1", "input"), node("output_1", "output")];
    const edges = [edge("input_1", "output_1", "value", "in")];
    expect(validateGraph(nodes, edges)).toEqual([]);
  });
});
