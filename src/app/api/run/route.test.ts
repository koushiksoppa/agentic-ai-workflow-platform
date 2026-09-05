import { beforeEach, describe, expect, it, vi } from "vitest";

const createRun = vi.fn();
const recordStep = vi.fn();
const finishRun = vi.fn();

vi.mock("@/lib/db/runs", () => ({
  createRun: (...args: unknown[]) => createRun(...args),
  recordStep: (...args: unknown[]) => recordStep(...args),
  finishRun: (...args: unknown[]) => finishRun(...args),
}));

const { POST } = await import("./route");

function workflow() {
  return {
    version: 1 as const,
    name: "test",
    nodes: [
      {
        id: "input_1",
        type: "workflow",
        position: { x: 0, y: 0 },
        data: { kind: "input", label: "in", config: { name: "topic", value: "otters" } },
      },
      {
        id: "output_1",
        type: "workflow",
        position: { x: 200, y: 0 },
        data: { kind: "output", label: "out", config: { name: "result" } },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "input_1",
        target: "output_1",
        sourceHandle: "value",
        targetHandle: "in",
      },
    ],
  };
}

function runRequest(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/** Drains the SSE stream into parsed events. */
async function drain(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, "")) as { type: string; status?: string });
}

beforeEach(() => {
  createRun.mockReset().mockResolvedValue("run_1");
  recordStep.mockReset().mockResolvedValue(undefined);
  finishRun.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/run — validation", () => {
  it("rejects a malformed request without opening a run", async () => {
    const response = await POST(runRequest({ workflow: { nodes: "nope" } }));
    expect(response.status).toBe(400);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("streams server-sent events", async () => {
    const response = await POST(runRequest({ workflow: workflow() }));
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await drain(response);
    expect(events[0].type).toBe("run:start");
    expect(events.at(-1)?.type).toBe("run:finish");
  });
});

describe("POST /api/run — run record lifecycle", () => {
  it("closes the run exactly once on success", async () => {
    await drain(await POST(runRequest({ workflow: workflow() })));
    expect(finishRun).toHaveBeenCalledTimes(1);
    expect(finishRun).toHaveBeenCalledWith("run_1", expect.objectContaining({ status: "success" }));
  });

  it("records a step per node", async () => {
    await drain(await POST(runRequest({ workflow: workflow() })));
    expect(recordStep).toHaveBeenCalledTimes(2);
    expect(recordStep.mock.calls.map((c) => c[1].nodeId)).toEqual(["input_1", "output_1"]);
  });

  it("closes the run as cancelled when the client has already gone", async () => {
    const controller = new AbortController();
    controller.abort();

    await drain(await POST(runRequest({ workflow: workflow() }, controller.signal)));

    // The regression this guards: a disconnect used to leave the row at
    // "running" forever, because the failure path returned before persisting.
    expect(finishRun).toHaveBeenCalledTimes(1);
    expect(finishRun.mock.calls[0][1].status).toBe("cancelled");
  });

  it("never closes the same run twice", async () => {
    const controller = new AbortController();
    controller.abort();
    await drain(await POST(runRequest({ workflow: workflow() }, controller.signal)));
    expect(finishRun).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/run — persistence is best effort", () => {
  it("still runs and streams when the run record cannot be opened", async () => {
    createRun.mockRejectedValue(new Error("database is locked"));
    const events = await drain(await POST(runRequest({ workflow: workflow() })));

    expect(events.at(-1)).toMatchObject({ type: "run:finish", status: "success" });
    // With no run id there is nothing to write against.
    expect(recordStep).not.toHaveBeenCalled();
    expect(finishRun).not.toHaveBeenCalled();
  });

  it("completes the run even when a step fails to persist", async () => {
    recordStep.mockRejectedValue(new Error("disk full"));
    const events = await drain(await POST(runRequest({ workflow: workflow() })));

    expect(events.at(-1)).toMatchObject({ type: "run:finish", status: "success" });
    expect(finishRun).toHaveBeenCalledTimes(1);
  });

  it("does not fail the request when closing the record throws", async () => {
    finishRun.mockRejectedValue(new Error("database is locked"));
    const events = await drain(await POST(runRequest({ workflow: workflow() })));
    expect(events.at(-1)).toMatchObject({ type: "run:finish", status: "success" });
  });
});
