import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunEvent } from "@/lib/engine/types";

const createMany = vi.fn();
const findMany = vi.fn();
const findFirst = vi.fn();

vi.mock("./client", () => ({
  prisma: {
    runEvent: {
      createMany: (...args: unknown[]) => createMany(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      findFirst: (...args: unknown[]) => findFirst(...args),
    },
  },
}));

const { appendRunEvents, lastRunEventSeq, listRunEvents, parseRunEvents } =
  await import("./events");

beforeEach(() => {
  createMany.mockReset().mockResolvedValue({ count: 0 });
  findMany.mockReset().mockResolvedValue([]);
  findFirst.mockReset().mockResolvedValue(null);
});

describe("appendRunEvents", () => {
  it("writes one row per event, in a single statement", async () => {
    await appendRunEvents("run_1", [
      { seq: 1, event: { type: "run:start", runId: "run_1", order: ["a"] } },
      { seq: 2, event: { type: "node:start", nodeId: "a", input: "x" } },
    ]);

    expect(createMany).toHaveBeenCalledTimes(1);
    const { data } = createMany.mock.calls[0][0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({ runId: "run_1", seq: 1, type: "run:start", nodeId: null });
    expect(data[1]).toMatchObject({ runId: "run_1", seq: 2, type: "node:start", nodeId: "a" });
  });

  it("stores the whole event as the payload", async () => {
    const event: RunEvent = {
      type: "node:success",
      nodeId: "a",
      output: { deep: [1, 2] },
      durationMs: 7,
      metadata: { branch: "true" },
    };
    await appendRunEvents("run_1", [{ seq: 1, event }]);

    const { data } = createMany.mock.calls[0][0];
    expect(JSON.parse(data[0].payload)).toEqual(event);
  });

  it("lifts nodeId into its own column only when the event has one", async () => {
    await appendRunEvents("run_1", [
      { seq: 1, event: { type: "run:finish", status: "success", durationMs: 1, outputs: {} } },
    ]);
    expect(createMany.mock.calls[0][0].data[0].nodeId).toBeNull();
  });

  it("does not touch the database for an empty batch", async () => {
    await appendRunEvents("run_1", []);
    expect(createMany).not.toHaveBeenCalled();
  });
});

describe("listRunEvents", () => {
  it("reads a run's events in sequence order", async () => {
    await listRunEvents("run_1");
    const args = findMany.mock.calls[0][0];
    expect(args.where).toEqual({ runId: "run_1" });
    expect(args.orderBy).toEqual({ seq: "asc" });
  });

  it("filters to events after the cursor", async () => {
    await listRunEvents("run_1", { afterSeq: 6 });
    expect(findMany.mock.calls[0][0].where).toEqual({ runId: "run_1", seq: { gt: 6 } });
  });

  it("treats a cursor of 0 as a real cursor, not an absent one", async () => {
    await listRunEvents("run_1", { afterSeq: 0 });
    expect(findMany.mock.calls[0][0].where).toEqual({ runId: "run_1", seq: { gt: 0 } });
  });

  it("applies a limit when asked, and none otherwise", async () => {
    await listRunEvents("run_1", { limit: 50 });
    expect(findMany.mock.calls[0][0].take).toBe(50);

    await listRunEvents("run_1");
    expect(findMany.mock.calls[1][0]).not.toHaveProperty("take");
  });
});

describe("lastRunEventSeq", () => {
  it("returns the highest sequence number written", async () => {
    findFirst.mockResolvedValue({ seq: 41 });
    expect(await lastRunEventSeq("run_1")).toBe(41);
    expect(findFirst.mock.calls[0][0].orderBy).toEqual({ seq: "desc" });
  });

  it("returns 0 for a run with no events, so numbering starts at 1", async () => {
    expect(await lastRunEventSeq("run_1")).toBe(0);
  });
});

describe("parseRunEvents", () => {
  it("parses stored rows back into engine events", () => {
    const event: RunEvent = { type: "node:skipped", nodeId: "b", reason: "pruned" };
    const parsed = parseRunEvents([
      { seq: 1, type: event.type, nodeId: "b", payload: JSON.stringify(event) },
    ]);
    expect(parsed).toEqual([event]);
  });

  it("skips a corrupt row rather than losing the whole run", () => {
    const good: RunEvent = { type: "node:start", nodeId: "a", input: 1 };
    const parsed = parseRunEvents([
      { seq: 1, type: "node:start", nodeId: "a", payload: "{not json" },
      { seq: 2, type: "node:start", nodeId: "a", payload: JSON.stringify(good) },
    ]);
    expect(parsed).toEqual([good]);
  });
});
