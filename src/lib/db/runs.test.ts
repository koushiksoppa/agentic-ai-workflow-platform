import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn();

vi.mock("./client", () => ({
  prisma: { run: { updateMany: (...args: unknown[]) => updateMany(...args) } },
}));

const { reconcileStaleRuns, reconcileStaleRunsThrottled, STALE_RUN_MS } = await import("./runs");

beforeEach(() => {
  updateMany.mockReset().mockResolvedValue({ count: 0 });
});

describe("reconcileStaleRuns", () => {
  it("only touches runs still marked running past the cutoff", async () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    await reconcileStaleRuns(STALE_RUN_MS, now);

    const { where, data } = updateMany.mock.calls[0][0];
    expect(where.status).toBe("running");
    expect(where.startedAt.lt).toEqual(new Date(now - STALE_RUN_MS));
    expect(data.status).toBe("cancelled");
    expect(data.error).toMatch(/Interrupted/);
    expect(data.finishedAt).toEqual(new Date(now));
  });

  it("leaves a run that has only just started", async () => {
    const now = Date.parse("2026-01-01T12:00:00.000Z");
    await reconcileStaleRuns(60_000, now);
    expect(updateMany.mock.calls[0][0].where.startedAt.lt).toEqual(new Date(now - 60_000));
  });

  it("reports how many runs it closed", async () => {
    updateMany.mockResolvedValue({ count: 3 });
    expect(await reconcileStaleRuns()).toBe(3);
  });
});

describe("reconcileStaleRunsThrottled", () => {
  it("does not hit the database again inside the interval", async () => {
    // The first call in this module's lifetime runs; the next is throttled.
    await reconcileStaleRunsThrottled(60_000);
    const afterFirst = updateMany.mock.calls.length;
    await reconcileStaleRunsThrottled(60_000);
    await reconcileStaleRunsThrottled(60_000);
    expect(updateMany.mock.calls.length).toBe(afterFirst);
  });

  it("swallows database errors so a listing still renders", async () => {
    updateMany.mockRejectedValue(new Error("database is locked"));
    // Interval of 0 forces this call past the throttle.
    await expect(reconcileStaleRunsThrottled(0)).resolves.toBeUndefined();
  });
});
