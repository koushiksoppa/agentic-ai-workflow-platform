import { describe, expect, it } from "vitest";
import { executeCondition } from "./condition";
import { executeInput } from "./input";
import { executeOutput } from "./output";
import { executeTransform } from "./transform";
import { evaluateExpression } from "../expression";
import type { ExecutorContext } from "../types";

function ctx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    nodeId: "n1",
    config: {},
    input: { bySource: {}, value: undefined },
    outputs: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("evaluateExpression", () => {
  it("evaluates against the incoming value", () => {
    expect(evaluateExpression("input * 2", 21, {})).toBe(42);
  });

  it("can reach other nodes' outputs", () => {
    expect(evaluateExpression("outputs.a.value", null, { a: { value: "x" } })).toBe("x");
  });

  it("reports a syntax error as a parse failure", () => {
    expect(() => evaluateExpression("input .. 2", 1, {})).toThrow(/could not be parsed/);
  });

  it("reports a thrown error with its message", () => {
    expect(() => evaluateExpression("input.missing.deep", {}, {})).toThrow(/Expression threw/);
  });

  it("returns undefined rather than throwing for a missing property", () => {
    expect(evaluateExpression("input.nothing", {}, {})).toBeUndefined();
  });
});

describe("executeInput", () => {
  it("emits its configured name and value", async () => {
    const result = await executeInput(ctx({ config: { name: "topic", value: "otters" } }));
    expect(result.output).toEqual({ name: "topic", value: "otters" });
  });

  it("resolves templates in its value", async () => {
    const result = await executeInput(
      ctx({
        config: { name: "greeting", value: "hi {{a.value}}" },
        outputs: { a: { value: "bob" } },
      }),
    );
    expect(result.output).toEqual({ name: "greeting", value: "hi bob" });
  });

  it("falls back to sensible defaults", async () => {
    expect((await executeInput(ctx())).output).toEqual({ name: "input", value: "" });
  });
});

describe("executeOutput", () => {
  it("captures whatever reached it under the configured name", async () => {
    const result = await executeOutput(
      ctx({ config: { name: "result" }, input: { bySource: {}, value: "PENGUINS" } }),
    );
    expect(result.output).toEqual({ name: "result", value: "PENGUINS" });
  });

  it("records an absent value rather than failing", async () => {
    expect((await executeOutput(ctx())).output).toEqual({ name: "result", value: undefined });
  });
});

describe("executeTransform", () => {
  it("reshapes the incoming value", async () => {
    const result = await executeTransform(
      ctx({
        config: { expression: "input.items.map(i => i.id)" },
        input: { bySource: {}, value: { items: [{ id: 1 }, { id: 2 }] } },
      }),
    );
    expect(result.output).toEqual([1, 2]);
  });

  it("passes the value straight through by default", async () => {
    const result = await executeTransform(ctx({ input: { bySource: {}, value: "x" } }));
    expect(result.output).toBe("x");
  });

  it("surfaces an expression failure", async () => {
    await expect(
      executeTransform(
        ctx({ config: { expression: "input.a.b" }, input: { bySource: {}, value: {} } }),
      ),
    ).rejects.toThrow(/Expression threw/);
  });
});

describe("executeCondition", () => {
  it("activates only the true handle and records the decision", async () => {
    const result = await executeCondition(
      ctx({ config: { expression: "input > 3" }, input: { bySource: {}, value: 10 } }),
    );
    expect(result.activeHandles).toEqual(["true"]);
    expect(result.metadata).toEqual({ branch: "true", expression: "input > 3" });
  });

  it("activates only the false handle", async () => {
    const result = await executeCondition(
      ctx({ config: { expression: "input > 3" }, input: { bySource: {}, value: 1 } }),
    );
    expect(result.activeHandles).toEqual(["false"]);
  });

  it("passes its input through untouched, so downstream nodes are unaffected", async () => {
    const value = { deep: { data: 1 } };
    const result = await executeCondition(
      ctx({ config: { expression: "true" }, input: { bySource: {}, value } }),
    );
    expect(result.output).toBe(value);
  });

  it("rejects a non-boolean result rather than guessing", async () => {
    await expect(
      executeCondition(ctx({ config: { expression: "'yes'" }, input: { bySource: {}, value: 1 } })),
    ).rejects.toThrow(/must evaluate to true or false, got string/);
  });

  it("treats a truthy non-boolean as an error, not as true", async () => {
    await expect(
      executeCondition(
        ctx({ config: { expression: "input.length" }, input: { bySource: {}, value: "abc" } }),
      ),
    ).rejects.toThrow(/got number/);
  });
});
