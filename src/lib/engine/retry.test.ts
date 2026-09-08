import { beforeEach, describe, expect, it, vi } from "vitest";

const executor = vi.fn();

vi.mock("./registry", () => ({
  getExecutor: () => executor,
}));

const { runToCompletion } = await import("./execute");
const { NodeExecutionError } = await import("./types");
const { retryDelay, resolveRetries, resolveTimeout } = await import("@/lib/nodes/execution-config");

import { getDefinition } from "@/lib/nodes/definitions";
import type { NodeConfig, WorkflowDocument, WorkflowNode } from "@/lib/types/workflow";
import type { RunEvent } from "./types";

function node(id: string, config: NodeConfig = {}): WorkflowNode {
  return {
    id,
    type: "workflow",
    position: { x: 0, y: 0 },
    data: {
      kind: "http",
      label: getDefinition("http").label,
      // A valid HTTP config; the executor itself is mocked.
      config: { ...getDefinition("http").defaultConfig, url: "https://example.com", ...config },
    },
  };
}

function doc(nodes: WorkflowNode[]): WorkflowDocument {
  return { version: 1, name: "retry", nodes, edges: [] };
}

const finish = (events: RunEvent[]) =>
  events.find((e) => e.type === "run:finish") as Extract<RunEvent, { type: "run:finish" }>;

beforeEach(() => {
  executor.mockReset();
});

describe("retry policy helpers", () => {
  it("defaults to no retries and clamps out-of-range values", () => {
    expect(resolveRetries(undefined)).toBe(0);
    expect(resolveRetries(3)).toBe(3);
    expect(resolveRetries(99)).toBe(5);
    expect(resolveRetries(-1)).toBe(0);
  });

  it("backs off exponentially, capped", () => {
    expect(retryDelay(1)).toBe(500);
    expect(retryDelay(2)).toBe(1000);
    expect(retryDelay(3)).toBe(2000);
    expect(retryDelay(20)).toBe(10_000);
  });

  it("clamps timeouts into the supported range", () => {
    expect(resolveTimeout(5000)).toBe(5000);
    expect(resolveTimeout(1)).toBe(1000);
    expect(resolveTimeout("nonsense")).toBe(30_000);
  });
});

describe("retrying a failed node", () => {
  it("retries a transient failure and succeeds", async () => {
    executor
      .mockRejectedValueOnce(new NodeExecutionError("connection reset", { retryable: true }))
      .mockResolvedValueOnce({ output: "recovered" });

    const events = await runToCompletion(doc([node("http_1", { retries: 2 })]));

    expect(executor).toHaveBeenCalledTimes(2);
    expect(finish(events).status).toBe("success");
    expect(finish(events).outputs.http_1).toBe("recovered");
  });

  it("emits a retry event describing the failed attempt", async () => {
    executor
      .mockRejectedValueOnce(new NodeExecutionError("503 upstream", { retryable: true }))
      .mockResolvedValueOnce({ output: "ok" });

    const events = await runToCompletion(doc([node("http_1", { retries: 1 })]));
    const retry = events.find((e) => e.type === "node:retry");

    expect(retry).toMatchObject({
      type: "node:retry",
      nodeId: "http_1",
      attempt: 1,
      attempts: 2,
      error: "503 upstream",
    });
  });

  it("records how many attempts a recovered node took", async () => {
    executor
      .mockRejectedValueOnce(new NodeExecutionError("flaky", { retryable: true }))
      .mockRejectedValueOnce(new NodeExecutionError("flaky", { retryable: true }))
      .mockResolvedValueOnce({ output: "ok" });

    const events = await runToCompletion(doc([node("http_1", { retries: 3 })]));
    const success = events.find((e) => e.type === "node:success");
    expect(success?.type === "node:success" ? success.metadata?.attempts : null).toBe(3);
  });

  it("does not retry a deterministic failure", async () => {
    // The default retryable is false: a 400 or a bad config fails identically
    // every time, and re-running a model call costs money.
    executor.mockRejectedValue(new NodeExecutionError("400 bad request"));

    const events = await runToCompletion(doc([node("http_1", { retries: 3 })]));

    expect(executor).toHaveBeenCalledTimes(1);
    expect(finish(events).status).toBe("error");
  });

  it("gives up after the configured number of attempts", async () => {
    executor.mockRejectedValue(new NodeExecutionError("still failing", { retryable: true }));

    const events = await runToCompletion(doc([node("http_1", { retries: 2 })]));

    expect(executor).toHaveBeenCalledTimes(3); // the first try plus two retries
    const failure = events.find((e) => e.type === "node:error");
    expect(failure?.type === "node:error" ? failure.error : "").toMatch(/still failing/);
  });

  it("makes a single attempt when retries are not configured", async () => {
    executor.mockRejectedValue(new NodeExecutionError("nope", { retryable: true }));
    await runToCompletion(doc([node("http_1", { retries: 0 })]));
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("attaches no attempt count when the first try succeeds", async () => {
    executor.mockResolvedValue({ output: "ok" });
    const events = await runToCompletion(doc([node("http_1", { retries: 3 })]));
    const success = events.find((e) => e.type === "node:success");
    expect(success?.type === "node:success" ? success.metadata : "none").toBeUndefined();
  });

  it("stops retrying as soon as the run is cancelled", async () => {
    const controller = new AbortController();
    executor.mockImplementation(() => {
      // Cancel partway through, as a user pressing Cancel would.
      controller.abort();
      return Promise.reject(new NodeExecutionError("transient", { retryable: true }));
    });

    const events = await runToCompletion(doc([node("http_1", { retries: 5 })]), {
      signal: controller.signal,
    });

    expect(executor).toHaveBeenCalledTimes(1);
    expect(finish(events).status).toBe("cancelled");
  });
});

describe("per-node timeout", () => {
  it("fails a node that outruns its timeout, and says so", async () => {
    // Never settles on its own; only the node deadline can end it.
    executor.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        }),
    );

    const events = await runToCompletion(doc([node("http_1", { timeoutMs: 1000, retries: 0 })]));

    const failure = events.find((e) => e.type === "node:error");
    expect(failure?.type === "node:error" ? failure.error : "").toMatch(/Timed out after 1s/);
    expect(finish(events).status).toBe("error");
  });

  it("gives each attempt its own deadline", async () => {
    let calls = 0;
    executor.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return Promise.resolve({ output: "second attempt was fine" });
    });

    const events = await runToCompletion(doc([node("http_1", { timeoutMs: 1000, retries: 1 })]));

    expect(calls).toBe(2);
    expect(finish(events).status).toBe("success");
  });
});
