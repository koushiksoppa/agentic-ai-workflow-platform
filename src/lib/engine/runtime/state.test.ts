import { describe, expect, it } from "vitest";
import { getDefinition } from "@/lib/nodes/definitions";
import type {
  NodeConfig,
  NodeKind,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from "@/lib/types/workflow";
import { runToCompletion } from "../execute";
import type { RunEvent } from "../types";
import { reconstructRun } from "./state";

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

function edge(source: string, target: string, sourceHandle: string | null = null): WorkflowEdge {
  return { id: `${source}:${sourceHandle}->${target}`, source, target, sourceHandle };
}

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDocument {
  return { version: 1, name: "test", nodes, edges };
}

describe("reconstructRun", () => {
  it("reports a run with no events as running and empty", () => {
    expect(reconstructRun([])).toEqual({
      runId: null,
      status: "running",
      order: [],
      steps: [],
      outputs: {},
    });
  });

  it("takes the run id and planned order from run:start", () => {
    const state = reconstructRun([{ type: "run:start", runId: "r1", order: ["a", "b"] }]);
    expect(state.runId).toBe("r1");
    expect(state.order).toEqual(["a", "b"]);
    expect(state.status).toBe("running");
  });

  it("marks a node running once it starts, and records its input", () => {
    const state = reconstructRun([
      { type: "run:start", runId: "r1", order: ["a"] },
      { type: "node:start", nodeId: "a", input: "hello" },
    ]);
    expect(state.steps).toEqual([
      { nodeId: "a", status: "running", position: null, input: "hello" },
    ]);
  });

  it("carries output, duration and metadata onto a successful step", () => {
    const state = reconstructRun([
      { type: "node:start", nodeId: "a", input: 1 },
      {
        type: "node:success",
        nodeId: "a",
        output: 2,
        durationMs: 12,
        metadata: { branch: "true" },
      },
    ]);
    expect(state.steps[0]).toMatchObject({
      nodeId: "a",
      status: "success",
      position: 0,
      input: 1,
      output: 2,
      durationMs: 12,
      metadata: { branch: "true" },
    });
    expect(state.outputs).toEqual({ a: 2 });
  });

  it("records a failure without an output", () => {
    const state = reconstructRun([
      { type: "node:start", nodeId: "a", input: null },
      { type: "node:error", nodeId: "a", error: "boom", durationMs: 5 },
    ]);
    expect(state.steps[0]).toMatchObject({ status: "error", error: "boom", durationMs: 5 });
    expect(state.steps[0]).not.toHaveProperty("output");
    expect(state.outputs).toEqual({});
  });

  it("keeps a skip reason as metadata", () => {
    const state = reconstructRun([
      { type: "node:skipped", nodeId: "b", reason: '"Check" took the false branch.' },
    ]);
    expect(state.steps[0]).toMatchObject({
      status: "skipped",
      metadata: { skipReason: '"Check" took the false branch.' },
    });
  });

  it("numbers steps in the order they reached a terminal state", () => {
    const state = reconstructRun([
      { type: "node:start", nodeId: "a", input: null },
      { type: "node:start", nodeId: "b", input: null },
      { type: "node:success", nodeId: "b", output: "b", durationMs: 1 },
      { type: "node:success", nodeId: "a", output: "a", durationMs: 1 },
    ]);
    expect(state.steps.map((s) => [s.nodeId, s.position])).toEqual([
      ["b", 0],
      ["a", 1],
    ]);
  });

  it("sorts nodes still running after every node that has finished", () => {
    const state = reconstructRun([
      { type: "node:start", nodeId: "slow", input: null },
      { type: "node:start", nodeId: "fast", input: null },
      { type: "node:success", nodeId: "fast", output: 1, durationMs: 1 },
    ]);
    expect(state.steps.map((s) => s.nodeId)).toEqual(["fast", "slow"]);
  });

  it("counts attempts when a node retried", () => {
    const state = reconstructRun([
      { type: "node:start", nodeId: "a", input: null },
      { type: "node:retry", nodeId: "a", attempt: 1, attempts: 3, delayMs: 100, error: "429" },
      { type: "node:success", nodeId: "a", output: "ok", durationMs: 9 },
    ]);
    expect(state.steps[0].metadata).toMatchObject({ attempts: 1 });
    expect(state.steps[0].status).toBe("success");
  });

  it("clears a previous failure when the node starts again", () => {
    const state = reconstructRun([
      { type: "node:start", nodeId: "a", input: null },
      { type: "node:error", nodeId: "a", error: "first", durationMs: 1 },
      { type: "node:start", nodeId: "a", input: null },
      { type: "node:success", nodeId: "a", output: "second", durationMs: 1 },
    ]);
    expect(state.steps[0]).toMatchObject({ status: "success", output: "second" });
    expect(state.steps[0]).not.toHaveProperty("error");
  });

  it("takes the final status, duration and error from run:finish", () => {
    const state = reconstructRun([
      { type: "run:start", runId: "r1", order: ["a"] },
      {
        type: "run:finish",
        status: "error",
        durationMs: 40,
        outputs: { a: 1 },
        error: "something failed",
      },
    ]);
    expect(state).toMatchObject({ status: "error", durationMs: 40, error: "something failed" });
    expect(state.outputs).toEqual({ a: 1 });
  });

  it("ignores deltas, which are never persisted", () => {
    const withDeltas = reconstructRun([
      { type: "node:start", nodeId: "a", input: null },
      { type: "node:delta", nodeId: "a", text: "par" },
      { type: "node:delta", nodeId: "a", text: "tial" },
      { type: "node:success", nodeId: "a", output: "partial", durationMs: 1 },
    ]);
    const without = reconstructRun([
      { type: "node:start", nodeId: "a", input: null },
      { type: "node:success", nodeId: "a", output: "partial", durationMs: 1 },
    ]);
    expect(withDeltas).toEqual(without);
  });

  it("tolerates an event type it does not know", () => {
    const events = [
      { type: "node:start", nodeId: "a", input: null },
      { type: "tool:called", nodeId: "a", tool: "search" },
      { type: "node:success", nodeId: "a", output: 1, durationMs: 1 },
    ] as unknown as RunEvent[];
    expect(() => reconstructRun(events)).not.toThrow();
    expect(reconstructRun(events).steps[0].status).toBe("success");
  });
});

/**
 * The acceptance criterion for the event log: whatever the engine did, the log
 * alone is enough to say what happened. These run the real engine and check the
 * projection against the events it produced.
 */
describe("reconstructRun against real executions", () => {
  it("reproduces a linear run", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("in", "input", { name: "topic", value: "widgets" }),
          node("out", "output", { name: "result" }),
        ],
        [edge("in", "out")],
      ),
    );

    const state = reconstructRun(events);
    expect(state.status).toBe("success");
    expect(state.order).toEqual(["in", "out"]);
    expect(state.steps.map((s) => [s.nodeId, s.status])).toEqual([
      ["in", "success"],
      ["out", "success"],
    ]);
    // Input nodes emit { name, value } so downstream templates can address them.
    expect(state.outputs.in).toEqual({ name: "topic", value: "widgets" });
  });

  it("reproduces a branch, including the pruned side", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("in", "input", { name: "n", value: "1" }),
          node("cond", "condition", { expression: "false" }),
          node("yes", "output", { name: "yes" }),
          node("no", "output", { name: "no" }),
        ],
        [edge("in", "cond"), edge("cond", "yes", "true"), edge("cond", "no", "false")],
      ),
    );

    const state = reconstructRun(events);
    const byId = Object.fromEntries(state.steps.map((s) => [s.nodeId, s]));
    expect(byId.cond.status).toBe("success");
    expect(byId.cond.metadata).toMatchObject({ branch: "false" });
    expect(byId.yes.status).toBe("skipped");
    expect(byId.yes.metadata?.skipReason).toMatch(/false branch/);
    expect(byId.no.status).toBe("success");
  });

  it("agrees with the engine on the final status of a failed run", async () => {
    const events = await runToCompletion(
      doc(
        [
          node("in", "input", { name: "n", value: "x" }),
          node("bad", "transform", { expression: "throw new Error('nope')" }),
          node("out", "output", { name: "out" }),
        ],
        [edge("in", "bad"), edge("bad", "out")],
      ),
    );

    const state = reconstructRun(events);
    expect(state.status).toBe("error");
    const byId = Object.fromEntries(state.steps.map((s) => [s.nodeId, s]));
    expect(byId.bad.status).toBe("error");
    expect(byId.out.status).toBe("skipped");
  });

  it("reconstructs the same state from a truncated log plus its finish", async () => {
    const events = await runToCompletion(
      doc(
        [node("in", "input", { name: "n", value: "v" }), node("out", "output", { name: "out" })],
        [edge("in", "out")],
      ),
    );

    // Simulate a reader that missed the middle of the log but saw the end.
    const finish = events.filter((e) => e.type === "run:finish");
    const truncated = reconstructRun([events[0], ...finish]);
    expect(truncated.status).toBe("success");
    expect(truncated.outputs).toEqual(reconstructRun(events).outputs);
  });
});
