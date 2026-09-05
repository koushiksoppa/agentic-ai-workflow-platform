import { describe, expect, it } from "vitest";
import { describeConfigIssues, validateNodeConfig } from "./validate";
import { getDefinition } from "./definitions";
import type { NodeKind } from "@/lib/types/workflow";

function withDefaults(kind: NodeKind, overrides: Record<string, unknown> = {}) {
  return { ...getDefinition(kind).defaultConfig, ...overrides };
}

describe("validateNodeConfig", () => {
  it("accepts a fully configured Model node", () => {
    expect(validateNodeConfig("llm", withDefaults("llm", { prompt: "Say hi" }))).toEqual({
      ok: true,
    });
  });

  it("reports an empty prompt against its editor label", () => {
    const result = validateNodeConfig("llm", withDefaults("llm"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        field: "prompt",
        label: "Prompt",
        message: "Prompt is required",
      });
    }
  });

  it("rejects a model id outside the supported set", () => {
    const result = validateNodeConfig("llm", withDefaults("llm", { prompt: "x", model: "gpt-4" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.field === "model")).toBe(true);
  });

  it("rejects a max_tokens above the supported ceiling", () => {
    const result = validateNodeConfig(
      "llm",
      withDefaults("llm", { prompt: "x", maxTokens: 999_999 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((i) => i.field === "maxTokens")).toBe(true);
  });

  it("reports a missing HTTP URL", () => {
    const result = validateNodeConfig("http", withDefaults("http"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].label).toBe("URL");
  });

  it("accepts an HTTP node saved before timeouts were configurable", () => {
    // timeoutMs is optional precisely so older documents stay valid.
    expect(
      validateNodeConfig("http", {
        method: "GET",
        url: "https://example.com",
        headers: "{}",
        body: "",
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a timeout outside the permitted range", () => {
    const result = validateNodeConfig(
      "http",
      withDefaults("http", { url: "https://example.com", timeoutMs: 10 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].field).toBe("timeoutMs");
  });

  it("requires an expression on Transform and Condition", () => {
    expect(validateNodeConfig("transform", { expression: "" }).ok).toBe(false);
    expect(validateNodeConfig("condition", { expression: "" }).ok).toBe(false);
  });

  it("accepts the defaults for nodes that need no configuration", () => {
    expect(validateNodeConfig("input", withDefaults("input")).ok).toBe(true);
    expect(validateNodeConfig("output", withDefaults("output")).ok).toBe(true);
    expect(validateNodeConfig("transform", withDefaults("transform")).ok).toBe(true);
    expect(validateNodeConfig("condition", withDefaults("condition")).ok).toBe(true);
  });

  it("reports one issue per field rather than repeating a field", () => {
    const result = validateNodeConfig("llm", { model: "nope", prompt: "", maxTokens: -5 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.issues.map((i) => i.field);
      expect(new Set(fields).size).toBe(fields.length);
    }
  });
});

describe("describeConfigIssues", () => {
  it("joins issues into one actionable sentence", () => {
    expect(
      describeConfigIssues([
        { field: "url", label: "URL", message: "URL is required" },
        { field: "timeoutMs", label: "Timeout (ms)", message: "Minimum 1000ms" },
      ]),
    ).toBe("URL: URL is required; Timeout (ms): Minimum 1000ms");
  });

  it("omits an empty label", () => {
    expect(describeConfigIssues([{ field: "", label: "", message: "Invalid input" }])).toBe(
      "Invalid input",
    );
  });
});
