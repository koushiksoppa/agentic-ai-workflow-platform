import { describe, expect, it } from "vitest";
import { hasReferences, readPath, resolveTemplate } from "./template";

describe("readPath", () => {
  it("walks a nested path", () => {
    expect(readPath({ a: { b: { c: 42 } } }, ["a", "b", "c"])).toBe(42);
  });

  it("returns undefined when the chain breaks", () => {
    expect(readPath({ a: null }, ["a", "b"])).toBeUndefined();
    expect(readPath({ a: 1 }, ["a", "b"])).toBeUndefined();
  });
});

describe("resolveTemplate", () => {
  const outputs = {
    input_1: { name: "topic", value: "otters" },
    http_1: { status: 200, body: { items: [1, 2, 3] } },
  };

  it("leaves plain text untouched", () => {
    expect(resolveTemplate("no refs here", outputs)).toBe("no refs here");
  });

  it("substitutes a field reference", () => {
    expect(resolveTemplate("Write about {{input_1.value}}.", outputs)).toBe(
      "Write about otters.",
    );
  });

  it("substitutes several references in one string", () => {
    expect(resolveTemplate("{{input_1.name}}={{input_1.value}}", outputs)).toBe(
      "topic=otters",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(resolveTemplate("{{  input_1.value  }}", outputs)).toBe("otters");
  });

  it("serializes objects as JSON", () => {
    expect(resolveTemplate("{{http_1.body}}", outputs)).toContain('"items"');
  });

  it("stringifies numbers", () => {
    expect(resolveTemplate("status {{http_1.status}}", outputs)).toBe("status 200");
  });

  it("throws on an unknown node, naming what is available", () => {
    expect(() => resolveTemplate("{{ghost.value}}", outputs)).toThrow(/Available: input_1, http_1/);
  });

  it("throws on a missing field rather than rendering nothing", () => {
    expect(() => resolveTemplate("{{input_1.nope}}", outputs)).toThrow(/no field "nope"/);
  });

  it("reports the empty reference", () => {
    expect(() => resolveTemplate("{{}}", outputs)).toThrow(/Empty reference/);
  });
});

describe("hasReferences", () => {
  it("is not confused by repeated calls on a global regex", () => {
    expect(hasReferences("{{a.b}}")).toBe(true);
    expect(hasReferences("{{a.b}}")).toBe(true);
    expect(hasReferences("plain")).toBe(false);
  });
});
