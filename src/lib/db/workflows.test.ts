import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();

vi.mock("./client", () => ({
  prisma: {
    workflow: {
      findMany: (...a: unknown[]) => findMany(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
    },
  },
}));

const { createWorkflow, deleteWorkflow, getWorkflow, listWorkflows, updateWorkflow } =
  await import("./workflows");

import type { WorkflowDocument } from "@/lib/types/workflow";

const UPDATED = new Date("2026-01-01T00:00:00.000Z");

function document(): WorkflowDocument {
  return {
    version: 1,
    name: "Demo",
    nodes: [
      {
        id: "input_1",
        type: "workflow",
        position: { x: 0, y: 0 },
        data: { kind: "input", label: "in", config: { name: "topic", value: "otters" } },
      },
    ],
    edges: [],
  };
}

beforeEach(() => {
  findMany.mockReset();
  findUnique.mockReset();
  create.mockReset();
  update.mockReset();
  deleteMany.mockReset();
});

describe("listWorkflows", () => {
  it("summarises rows without returning the graph body", async () => {
    findMany.mockResolvedValue([
      {
        id: "w1",
        name: "Demo",
        document: JSON.stringify({ nodes: [1, 2, 3], edges: [] }),
        updatedAt: UPDATED,
      },
    ]);

    const [summary] = await listWorkflows();
    expect(summary).toEqual({
      id: "w1",
      name: "Demo",
      nodeCount: 3,
      updatedAt: UPDATED.toISOString(),
    });
    expect(summary).not.toHaveProperty("document");
  });

  it("reports zero nodes for a row whose body will not parse", async () => {
    // A corrupt row must not break the whole listing.
    findMany.mockResolvedValue([
      { id: "w1", name: "Broken", document: "{not json", updatedAt: UPDATED },
    ]);
    expect((await listWorkflows())[0].nodeCount).toBe(0);
  });
});

describe("getWorkflow", () => {
  it("returns null when the id does not exist", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getWorkflow("missing")).toBeNull();
  });

  it("round-trips a document through storage", async () => {
    const doc = document();
    findUnique.mockResolvedValue({
      id: "w1",
      name: "Demo",
      document: JSON.stringify({ nodes: doc.nodes, edges: doc.edges }),
      updatedAt: UPDATED,
    });

    const saved = await getWorkflow("w1");
    expect(saved?.document.nodes).toEqual(doc.nodes);
    expect(saved?.document.name).toBe("Demo");
  });

  it("degrades to an empty graph rather than throwing on a corrupt body", async () => {
    findUnique.mockResolvedValue({
      id: "w1",
      name: "Broken",
      document: "}}}",
      updatedAt: UPDATED,
    });

    const saved = await getWorkflow("w1");
    expect(saved?.document).toEqual({ version: 1, name: "Broken", nodes: [], edges: [] });
  });
});

describe("createWorkflow", () => {
  it("stores only the graph, taking the name from the column", async () => {
    create.mockResolvedValue({ id: "w1", name: "Demo", updatedAt: UPDATED });
    await createWorkflow(document());

    const { data } = create.mock.calls[0][0];
    expect(data.name).toBe("Demo");
    const stored = JSON.parse(data.document);
    expect(Object.keys(stored).sort()).toEqual(["edges", "nodes"]);
  });

  it("falls back to a placeholder name", async () => {
    create.mockResolvedValue({ id: "w1", name: "Untitled workflow", updatedAt: UPDATED });
    await createWorkflow({ ...document(), name: "" });
    expect(create.mock.calls[0][0].data.name).toBe("Untitled workflow");
  });
});

describe("updateWorkflow", () => {
  it("returns null for an id that no longer exists, without writing", async () => {
    findUnique.mockResolvedValue(null);
    expect(await updateWorkflow("gone", document())).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("writes when the row exists", async () => {
    findUnique.mockResolvedValue({ id: "w1" });
    update.mockResolvedValue({ id: "w1", name: "Demo", updatedAt: UPDATED });

    const saved = await updateWorkflow("w1", document());
    expect(saved?.id).toBe("w1");
    expect(update.mock.calls[0][0].where).toEqual({ id: "w1" });
  });
});

describe("deleteWorkflow", () => {
  it("reports whether anything was removed", async () => {
    deleteMany.mockResolvedValue({ count: 1 });
    expect(await deleteWorkflow("w1")).toBe(true);

    deleteMany.mockResolvedValue({ count: 0 });
    expect(await deleteWorkflow("missing")).toBe(false);
  });
});
