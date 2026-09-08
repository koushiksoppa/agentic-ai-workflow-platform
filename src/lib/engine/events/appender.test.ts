import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingRunEvent } from "@/lib/db/events";
import type { RunEvent } from "../types";

const appendRunEvents = vi.fn();

vi.mock("@/lib/db/events", () => ({
  appendRunEvents: (...args: unknown[]) => appendRunEvents(...args),
}));

const { createRunEventSink } = await import("./appender");

/** Every event the mock was asked to write, flattened into arrival order. */
function written(): PendingRunEvent[] {
  return appendRunEvents.mock.calls.flatMap((call) => call[1] as PendingRunEvent[]);
}

const start = (nodeId: string): RunEvent => ({ type: "node:start", nodeId, input: null });
const success = (nodeId: string): RunEvent => ({
  type: "node:success",
  nodeId,
  output: nodeId,
  durationMs: 1,
});

beforeEach(() => {
  appendRunEvents.mockReset().mockResolvedValue(undefined);
});

describe("createRunEventSink", () => {
  it("assigns dense, strictly increasing sequence numbers", async () => {
    const sink = createRunEventSink("run_1");
    sink.append(start("a"));
    sink.append(success("a"));
    sink.append(start("b"));
    await sink.flush();

    expect(written().map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("preserves emission order even when writes are slow", async () => {
    // Resolve the first write only after later events have been appended, so
    // the chain has to hold the ordering rather than luck into it.
    let releaseFirst: () => void = () => {};
    appendRunEvents.mockImplementationOnce(
      () => new Promise<void>((resolve) => (releaseFirst = resolve)),
    );

    const sink = createRunEventSink("run_1");
    sink.append(start("a"));
    await Promise.resolve(); // let the first write begin
    sink.append(start("b"));
    sink.append(start("c"));
    releaseFirst();
    await sink.flush();

    const seqs = written().map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(written().map((e) => ("nodeId" in e.event ? e.event.nodeId : null))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("batches events that arrive while a write is in flight", async () => {
    let release: () => void = () => {};
    appendRunEvents.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );

    const sink = createRunEventSink("run_1");
    sink.append(start("a"));
    await Promise.resolve();
    sink.append(start("b"));
    sink.append(start("c"));
    release();
    await sink.flush();

    // One call for "a", then a single call carrying both "b" and "c" — not one
    // round-trip per event.
    expect(appendRunEvents).toHaveBeenCalledTimes(2);
    expect(appendRunEvents.mock.calls[1][1]).toHaveLength(2);
  });

  it("does not persist deltas", async () => {
    const sink = createRunEventSink("run_1");
    sink.append(start("a"));
    sink.append({ type: "node:delta", nodeId: "a", text: "chunk" });
    sink.append({ type: "node:delta", nodeId: "a", text: "chunk" });
    sink.append(success("a"));
    await sink.flush();

    expect(written().map((e) => e.event.type)).toEqual(["node:start", "node:success"]);
    // Sequence numbers stay dense; a dropped delta does not leave a gap.
    expect(written().map((e) => e.seq)).toEqual([1, 2]);
  });

  it("keeps going after a write fails, and reports it", async () => {
    const onError = vi.fn();
    appendRunEvents.mockRejectedValueOnce(new Error("database is locked"));

    const sink = createRunEventSink("run_1", { onError });
    sink.append(start("a"));
    await sink.flush();

    sink.append(success("a"));
    await sink.flush();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    // The failure did not poison the chain: the next append still wrote.
    expect(appendRunEvents).toHaveBeenCalledTimes(2);
  });

  it("never throws out of append, whatever the database does", async () => {
    appendRunEvents.mockRejectedValue(new Error("gone"));
    const sink = createRunEventSink("run_1", { onError: () => {} });

    expect(() => {
      sink.append(start("a"));
      sink.append(success("a"));
    }).not.toThrow();
    await expect(sink.flush()).resolves.toBeUndefined();
  });

  it("continues numbering from an existing log when given a start", async () => {
    const sink = createRunEventSink("run_1", { startSeq: 12 });
    sink.append(start("a"));
    sink.append(success("a"));
    await sink.flush();

    expect(written().map((e) => e.seq)).toEqual([12, 13]);
  });

  it("reports the last sequence number it assigned", async () => {
    const sink = createRunEventSink("run_1");
    expect(sink.lastSeq).toBe(0);
    sink.append(start("a"));
    expect(sink.lastSeq).toBe(1);
    sink.append({ type: "node:delta", nodeId: "a", text: "x" });
    expect(sink.lastSeq).toBe(1);
    await sink.flush();
  });

  it("flush resolves immediately when nothing was appended", async () => {
    const sink = createRunEventSink("run_1");
    await expect(sink.flush()).resolves.toBeUndefined();
    expect(appendRunEvents).not.toHaveBeenCalled();
  });

  it("flush waits for writes queued by earlier writes", async () => {
    const order: string[] = [];
    appendRunEvents.mockImplementation(async (_runId: string, batch: PendingRunEvent[]) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(batch.map((e) => e.seq).join(","));
    });

    const sink = createRunEventSink("run_1");
    sink.append(start("a"));
    await Promise.resolve();
    sink.append(start("b"));
    await sink.flush();

    expect(order).toEqual(["1", "2"]);
  });
});
