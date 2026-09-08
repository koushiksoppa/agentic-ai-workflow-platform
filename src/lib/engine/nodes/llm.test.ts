import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const streamMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  class AuthenticationError extends APIError {}
  class PermissionDeniedError extends APIError {}
  class NotFoundError extends APIError {}
  class RateLimitError extends APIError {}
  class BadRequestError extends APIError {}
  class APIConnectionError extends APIError {}
  class InternalServerError extends APIError {}

  class Anthropic {
    messages = { stream: streamMock };
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static PermissionDeniedError = PermissionDeniedError;
    static NotFoundError = NotFoundError;
    static RateLimitError = RateLimitError;
    static BadRequestError = BadRequestError;
    static APIConnectionError = APIConnectionError;
    static InternalServerError = InternalServerError;
  }

  return { default: Anthropic };
});

const { executeLlm } = await import("./llm");
const Anthropic = (await import("@anthropic-ai/sdk")).default as unknown as {
  AuthenticationError: new (m: string) => Error;
  RateLimitError: new (m: string) => Error;
  BadRequestError: new (m: string) => Error;
  InternalServerError: new (m: string) => Error;
};

interface FakeMessage {
  content: { type: string; text?: string }[];
  model: string;
  stop_reason: string;
  stop_details?: { category?: string } | null;
  usage: { input_tokens: number; output_tokens: number };
}

function fakeMessage(overrides: Partial<FakeMessage> = {}): FakeMessage {
  return {
    content: [{ type: "text", text: "hello" }],
    model: "claude-opus-5",
    stop_reason: "end_turn",
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 5 },
    ...overrides,
  };
}

/** Stands in for the SDK's MessageStream: emits deltas, then resolves. */
function fakeStream(message: FakeMessage, deltas: string[] = []) {
  return {
    on(event: string, handler: (text: string) => void) {
      if (event === "text") for (const d of deltas) handler(d);
      return this;
    },
    finalMessage: async () => message,
  };
}

function ctx(config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    nodeId: "llm_1",
    config,
    input: { bySource: {}, value: undefined },
    outputs: {},
    signal: new AbortController().signal,
    ...extra,
  } as Parameters<typeof executeLlm>[0];
}

const BASE = {
  model: "claude-opus-5",
  prompt: "Say hi",
  system: "",
  maxTokens: 1000,
  effort: "high",
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  streamMock.mockReset();
  streamMock.mockReturnValue(fakeStream(fakeMessage()));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("executeLlm configuration", () => {
  it("fails clearly when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(executeLlm(ctx(BASE))).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("rejects an unknown model id", async () => {
    await expect(executeLlm(ctx({ ...BASE, model: "gpt-4" }))).rejects.toThrow(/Unknown model/);
  });

  it("rejects an empty prompt", async () => {
    await expect(executeLlm(ctx({ ...BASE, prompt: "   " }))).rejects.toThrow(/prompt is empty/i);
  });

  it("sends adaptive thinking and effort to Opus 5", async () => {
    await executeLlm(ctx({ ...BASE, model: "claude-opus-5", effort: "xhigh" }));
    const params = streamMock.mock.calls[0][0];
    expect(params.thinking).toEqual({ type: "adaptive" });
    expect(params.output_config).toEqual({ effort: "xhigh" });
    expect(params.stream).toBe(true);
  });

  it("omits thinking and effort for Haiku 4.5, which rejects both", async () => {
    await executeLlm(ctx({ ...BASE, model: "claude-haiku-4-5" }));
    const params = streamMock.mock.calls[0][0];
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toBeUndefined();
  });

  it("omits an empty system prompt rather than sending a blank string", async () => {
    await executeLlm(ctx({ ...BASE, system: "  " }));
    expect(streamMock.mock.calls[0][0].system).toBeUndefined();
  });

  it("clamps max_tokens into the supported range", async () => {
    await executeLlm(ctx({ ...BASE, maxTokens: 999_999 }));
    expect(streamMock.mock.calls[0][0].max_tokens).toBe(128_000);
  });

  it("falls back to a sane max_tokens when the value is not a number", async () => {
    await executeLlm(ctx({ ...BASE, maxTokens: "lots" }));
    expect(streamMock.mock.calls[0][0].max_tokens).toBe(16_000);
  });
});

describe("executeLlm templating", () => {
  it("resolves upstream references in the prompt", async () => {
    await executeLlm(
      ctx(
        { ...BASE, prompt: "Summarize {{input_1.value}}" },
        { outputs: { input_1: { value: "otters" } } },
      ),
    );
    expect(streamMock.mock.calls[0][0].messages[0].content).toBe("Summarize otters");
  });

  it("binds {{input}} to the value arriving on this node's edges", async () => {
    await executeLlm(
      ctx(
        { ...BASE, prompt: "Rewrite: {{input}}" },
        { input: { bySource: {}, value: "raw text" } },
      ),
    );
    expect(streamMock.mock.calls[0][0].messages[0].content).toBe("Rewrite: raw text");
  });

  it("fails on an unresolvable reference instead of sending a broken prompt", async () => {
    await expect(executeLlm(ctx({ ...BASE, prompt: "Use {{ghost.value}}" }))).rejects.toThrow(
      /Unknown reference/,
    );
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe("executeLlm responses", () => {
  it("returns the concatenated text with usage", async () => {
    streamMock.mockReturnValue(
      fakeStream(
        fakeMessage({
          content: [
            { type: "thinking" },
            { type: "text", text: "part one " },
            { type: "text", text: "part two" },
          ],
        }),
      ),
    );
    const result = await executeLlm(ctx(BASE));
    expect(result.output).toMatchObject({
      text: "part one part two",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 5 },
      truncated: false,
    });
  });

  it("throws on a refusal, naming the category", async () => {
    streamMock.mockReturnValue(
      fakeStream(
        fakeMessage({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }),
      ),
    );
    await expect(executeLlm(ctx(BASE))).rejects.toThrow(/declined this request \(cyber\)/);
  });

  it("flags truncation rather than throwing, since the text is still real", async () => {
    streamMock.mockReturnValue(fakeStream(fakeMessage({ stop_reason: "max_tokens" })));
    const result = await executeLlm(ctx(BASE));
    expect((result.output as { truncated: boolean }).truncated).toBe(true);
  });

  it("forwards streamed deltas through onDelta", async () => {
    streamMock.mockReturnValue(fakeStream(fakeMessage(), ["he", "ll", "o"]));
    const seen: string[] = [];
    await executeLlm(ctx(BASE, { onDelta: (t: string) => seen.push(t) }));
    expect(seen).toEqual(["he", "ll", "o"]);
  });
});

describe("executeLlm error mapping", () => {
  it("explains an authentication failure in terms of the key", async () => {
    streamMock.mockImplementation(() => {
      throw new Anthropic.AuthenticationError("401");
    });
    await expect(executeLlm(ctx(BASE))).rejects.toThrow(/check ANTHROPIC_API_KEY/);
  });

  it("explains a rate limit", async () => {
    streamMock.mockImplementation(() => {
      throw new Anthropic.RateLimitError("429");
    });
    await expect(executeLlm(ctx(BASE))).rejects.toThrow(/Rate limited/);
  });

  it("reports cancellation as cancellation, not as an API failure", async () => {
    const controller = new AbortController();
    controller.abort();
    streamMock.mockImplementation(() => {
      throw new Error("aborted");
    });
    await expect(executeLlm(ctx(BASE, { signal: controller.signal }))).rejects.toThrow(
      /Run cancelled/,
    );
  });
});

describe("delta streaming through the engine", () => {
  it("emits node:delta events between node:start and node:success", async () => {
    const { runToCompletion } = await import("../execute");
    streamMock.mockReturnValue(
      fakeStream(fakeMessage({ content: [{ type: "text", text: "hi" }] }), ["h", "i"]),
    );

    const events = await runToCompletion({
      version: 1,
      name: "t",
      nodes: [
        {
          id: "llm_1",
          type: "workflow",
          position: { x: 0, y: 0 },
          data: { kind: "llm", label: "Model", config: { ...BASE } },
        },
      ],
      edges: [],
    });

    const types = events.map((e) => e.type);
    const start = types.indexOf("node:start");
    const success = types.indexOf("node:success");
    const deltas = events.filter((e) => e.type === "node:delta");

    expect(deltas.map((d) => (d.type === "node:delta" ? d.text : ""))).toEqual(["h", "i"]);
    // Deltas must land between start and success, not be flushed afterwards.
    for (const [i, e] of events.entries()) {
      if (e.type === "node:delta") {
        expect(i).toBeGreaterThan(start);
        expect(i).toBeLessThan(success);
      }
    }
  });
});
