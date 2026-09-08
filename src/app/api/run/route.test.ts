import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@/lib/engine/types";

const createRun = vi.fn();
const recordStep = vi.fn();
const finishRun = vi.fn();
const appendRunEvents = vi.fn();

vi.mock("@/lib/db/runs", () => ({
  createRun: (...args: unknown[]) => createRun(...args),
  recordStep: (...args: unknown[]) => recordStep(...args),
  finishRun: (...args: unknown[]) => finishRun(...args),
}));

// The appender reaches the database through this module; without the mock these
// tests would write real rows into the development database.
vi.mock("@/lib/db/events", () => ({
  appendRunEvents: (...args: unknown[]) => appendRunEvents(...args),
}));

const { POST } = await import("./route");
const { reconstructRun } = await import("@/lib/engine/runtime/state");

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

/** Every event the route wrote to the log, in sequence order. */
function logged() {
  return appendRunEvents.mock.calls
    .flatMap((call) => call[1] as { seq: number; event: RunEvent }[])
    .sort((a, b) => a.seq - b.seq);
}

beforeEach(() => {
  createRun.mockReset().mockResolvedValue("run_1");
  recordStep.mockReset().mockResolvedValue(undefined);
  finishRun.mockReset().mockResolvedValue(undefined);
  appendRunEvents.mockReset().mockResolvedValue(undefined);
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

describe("POST /api/run — duplicate execution", () => {
  it("refuses a second concurrent run of the same saved workflow", async () => {
    // Hold the first run open so the second arrives while it is in flight.
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    createRun.mockImplementation(async () => {
      await blocked;
      return "run_1";
    });

    const first = POST(runRequest({ workflow: workflow(), workflowId: "wf_1" }));
    const second = await POST(runRequest({ workflow: workflow(), workflowId: "wf_1" }));

    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toMatch(/already running/);

    release();
    await drain(await first);
  });

  it("releases the lock once the run finishes", async () => {
    await drain(await POST(runRequest({ workflow: workflow(), workflowId: "wf_2" })));
    const second = await POST(runRequest({ workflow: workflow(), workflowId: "wf_2" }));
    expect(second.status).toBe(200);
    await drain(second);
  });

  it("does not lock unsaved drafts against each other", async () => {
    const a = await POST(runRequest({ workflow: workflow() }));
    const b = await POST(runRequest({ workflow: workflow() }));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    await Promise.all([drain(a), drain(b)]);
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

describe("POST /api/run — event log", () => {
  it("writes the run to the log against the run's id", async () => {
    await drain(await POST(runRequest({ workflow: workflow() })));
    expect(appendRunEvents.mock.calls.every((call) => call[0] === "run_1")).toBe(true);
  });

  it("logs every event the client received, in the same order", async () => {
    const streamed = await drain(await POST(runRequest({ workflow: workflow() })));
    expect(logged().map((e) => e.event.type)).toEqual(streamed.map((e) => e.type));
  });

  it("numbers events densely from 1", async () => {
    await drain(await POST(runRequest({ workflow: workflow() })));
    const seqs = logged().map((e) => e.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  });

  it("writes a log a reader can reconstruct the whole run from", async () => {
    await drain(await POST(runRequest({ workflow: workflow() })));

    // The acceptance criterion for this step: the log alone is enough.
    const state = reconstructRun(logged().map((e) => e.event));
    expect(state.runId).toBe("run_1");
    expect(state.status).toBe("success");
    expect(state.steps.map((s) => [s.nodeId, s.status])).toEqual([
      ["input_1", "success"],
      ["output_1", "success"],
    ]);
  });

  it("logs a terminal event even when the client vanished first", async () => {
    const controller = new AbortController();
    controller.abort();
    await drain(await POST(runRequest({ workflow: workflow() }, controller.signal)));

    // Without this the log would reconstruct as "running" while the run row
    // said "cancelled" — the projection is supposed to be authoritative, so it
    // does not get to disagree with the record it derives.
    const state = reconstructRun(logged().map((e) => e.event));
    expect(state.status).toBe("cancelled");
    expect(logged().filter((e) => e.event.type === "run:finish")).toHaveLength(1);
  });

  it("does not log a second terminal event when the run ended normally", async () => {
    await drain(await POST(runRequest({ workflow: workflow() })));
    expect(logged().filter((e) => e.event.type === "run:finish")).toHaveLength(1);
  });

  it("flushes the log before the response ends", async () => {
    // Make the write settle a tick late; the route must still have waited.
    appendRunEvents.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 1)));
    await drain(await POST(runRequest({ workflow: workflow() })));
    expect(logged().at(-1)?.event.type).toBe("run:finish");
  });

  it("completes the run when the log cannot be written", async () => {
    appendRunEvents.mockRejectedValue(new Error("database is locked"));
    const events = await drain(await POST(runRequest({ workflow: workflow() })));

    expect(events.at(-1)).toMatchObject({ type: "run:finish", status: "success" });
    expect(finishRun).toHaveBeenCalledTimes(1);
  });

  it("writes nothing when there is no run record to attach the log to", async () => {
    createRun.mockRejectedValue(new Error("database is locked"));
    await drain(await POST(runRequest({ workflow: workflow() })));
    expect(appendRunEvents).not.toHaveBeenCalled();
  });
});
