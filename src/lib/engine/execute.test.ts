import { describe, expect, it } from "vitest";
import { runToCompletion } from "./execute";
import { topologicalOrder } from "./topology";
import { getDefinition } from "@/lib/nodes/definitions";
import type {
  NodeConfig,
  NodeKind,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/types/workflow";
import type { RunEvent } from "./types";

function node(id: string, kind: NodeKind, config: NodeConfig = {}): WorkflowNode {
  return {
    id,
    type: "workflow",
    position: { x: 0, y: 0 },
    data: {
      kind,
      label: getDefinition(kind).label,
      config: { ...getDefinition(kind).defaultConfig, ...config },
    },
  };
}

function edge(
  source: string,
  target: string,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
): WorkflowEdge {
  return { id: `${source}:${sourceHandle}->${target}`, source, target, sourceHandle, targetHandle };
}

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDocument {
  return { version: 1, name: "test", nodes, edges };
}

const finish = (events: RunEvent[]) =>
  events.find((e) => e.type === "run:finish") as Extract<RunEvent, { type: "run:finish" }>;

const statusOf = (events: RunEvent[], nodeId: string) => {
  const event = [...events]
    .reverse()
    .find(
      (e) =>
        (e.type === "node:success" || e.type === "node:error" || e.type === "node:skipped") &&
        e.nodeId === nodeId,
    );
  return event?.type ?? "never-ran";
};

describe("topologicalOrder", () => {
  it("orders a linear chain", () => {
    const result = topologicalOrder(
      [node("a", "input"), node("b", "transform"), node("c", "output")],
      [edge("a", "b"), edge("b", "c")],
    );
    expect(result).toEqual({ ok: true, order: ["a", "b", "c"] });
  });

  it("rejects a cycle", () => {
    const result = topologicalOrder(
      [node("a", "transform"), node("b", "transform")],
      [edge("a", "b"), edge("b", "a")],
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/cycle/);
  });

  it("rejects an edge pointing at a missing node", () => {
    const result = topologicalOrder([node("a", "input")], [edge("a", "ghost")]);
    expect(result.ok).toBe(false);
  });
});

describe("executeWorkflow", () => {
  it("runs a linear graph and collects the result", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "topic", value: "otters" }),
          node("transform_1", "transform", { expression: "input.value.toUpperCase()" }),
          node("output_1", "output", { name: "result" }),
        ],
        [edge("input_1", "transform_1"), edge("transform_1", "output_1")],
      ),
    );

    const done = finish(events);
    expect(done.status).toBe("success");
    expect(done.outputs.transform_1).toBe("OTTERS");
    expect(done.outputs.output_1).toEqual({ name: "result", value: "OTTERS" });
  });

  it("applies a per-run input override by name", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "topic", value: "default" }),
          node("output_1", "output"),
        ],
        [edge("input_1", "output_1")],
      ),
      { inputs: { topic: "overridden" } },
    );

    expect(finish(events).outputs.output_1).toEqual({
      name: "result",
      value: { name: "topic", value: "overridden" },
    });
  });

  it("resolves templates against upstream output", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "a", value: "hello" }),
          node("input_2", "input", { name: "b", value: "{{input_1.value}} world" }),
        ],
        [edge("input_1", "input_2")],
      ),
    );
    expect(finish(events).outputs.input_2).toEqual({ name: "b", value: "hello world" });
  });

  it("takes only the true branch when the condition holds", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "n", value: "yes" }),
          node("condition_1", "condition", { expression: "input.value.length > 0" }),
          node("output_1", "output", { name: "onTrue" }),
          node("output_2", "output", { name: "onFalse" }),
        ],
        [
          edge("input_1", "condition_1"),
          edge("condition_1", "output_1", "true"),
          edge("condition_1", "output_2", "false"),
        ],
      ),
    );

    expect(statusOf(events, "output_1")).toBe("node:success");
    expect(statusOf(events, "output_2")).toBe("node:skipped");
    expect(finish(events).status).toBe("success");
  });

  it("takes only the false branch when the condition fails", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "n", value: "" }),
          node("condition_1", "condition", { expression: "input.value.length > 0" }),
          node("output_1", "output", { name: "onTrue" }),
          node("output_2", "output", { name: "onFalse" }),
        ],
        [
          edge("input_1", "condition_1"),
          edge("condition_1", "output_1", "true"),
          edge("condition_1", "output_2", "false"),
        ],
      ),
    );

    expect(statusOf(events, "output_1")).toBe("node:skipped");
    expect(statusOf(events, "output_2")).toBe("node:success");
  });

  it("rejects a condition that does not yield a boolean", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "n", value: "x" }),
          node("condition_1", "condition", { expression: "input.value" }),
        ],
        [edge("input_1", "condition_1")],
      ),
    );
    expect(statusOf(events, "condition_1")).toBe("node:error");
    expect(finish(events).status).toBe("error");
  });

  it("skips descendants of a failure but still runs independent branches", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "a", value: "ok" }),
          node("transform_1", "transform", { expression: "input.nope.crash" }),
          node("output_1", "output", { name: "downstream" }),
          node("input_2", "input", { name: "b", value: "independent" }),
          node("output_2", "output", { name: "sibling" }),
        ],
        [
          edge("input_1", "transform_1"),
          edge("transform_1", "output_1"),
          edge("input_2", "output_2"),
        ],
      ),
    );

    expect(statusOf(events, "transform_1")).toBe("node:error");
    expect(statusOf(events, "output_1")).toBe("node:skipped");
    expect(statusOf(events, "output_2")).toBe("node:success");
    expect(finish(events).status).toBe("error");
  });

  it("reports a cycle without emitting node events", async () => {
    const events = await runToCompletion(
      doc(
        [node("a", "transform"), node("b", "transform")],
        [edge("a", "b"), edge("b", "a")],
      ),
    );

    expect(events.some((e) => e.type === "node:start")).toBe(false);
    expect(finish(events).error).toMatch(/cycle/);
  });

  it("fails a Model node with actionable guidance when no API key is configured", async () => {
    const previous = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const events = await runToCompletion(doc([node("llm_1", "llm", { prompt: "hi" })], []));
      const failure = events.find((e) => e.type === "node:error");
      expect(failure).toBeDefined();
      if (failure && failure.type === "node:error") {
        expect(failure.error).toMatch(/ANTHROPIC_API_KEY/);
      }
      expect(finish(events).status).toBe("error");
    } finally {
      if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous;
    }
  });

  it("stops when the run is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await runToCompletion(
      doc([node("input_1", "input"), node("output_1", "output")], [edge("input_1", "output_1")]),
      { signal: controller.signal },
    );
    expect(finish(events).status).toBe("cancelled");
  });

  it("merges several live inputs into an array", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("input_1", "input", { name: "a", value: "one" }),
          node("input_2", "input", { name: "b", value: "two" }),
          node("transform_1", "transform", { expression: "input.map(i => i.value).join(',')" }),
        ],
        [edge("input_1", "transform_1"), edge("input_2", "transform_1")],
      ),
    );
    expect(finish(events).outputs.transform_1).toBe("one,two");
  });

  it("emits start and finish around the run", async () => {
    const events = await runToCompletion(doc([node("input_1", "input")], []));
    expect(events[0].type).toBe("run:start");
    expect(events[events.length - 1].type).toBe("run:finish");
  });
});
