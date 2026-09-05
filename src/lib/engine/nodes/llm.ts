import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_MODEL, getModel, isKnownModel } from "@/lib/nodes/models";
import { resolveTemplate, scopeFor } from "../template";
import { NodeExecutionError, type NodeExecutor } from "../types";

/** Built once per process; the SDK client is stateless across requests. */
let cachedClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new NodeExecutionError(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }
  cachedClient ??= new Anthropic();
  return cachedClient;
}

const MIN_TOKENS = 1;
const MAX_TOKENS = 128_000;

function clampTokens(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 16_000;
  return Math.min(MAX_TOKENS, Math.max(MIN_TOKENS, Math.trunc(n)));
}

/** Turns SDK errors into messages that mean something on a node card. */
function describe(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "Authentication failed — check ANTHROPIC_API_KEY.";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "The API key does not have access to this model.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "Model not found — the id may be wrong or unavailable to this account.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "Rate limited by the API. Retry shortly, or lower the workflow's concurrency.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `The API rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "Could not reach the API — check the network connection.";
  }
  if (error instanceof Anthropic.APIError) {
    return `API error ${error.status ?? ""}: ${error.message}`.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends the node's prompt to a model and returns the text response.
 *
 * Streams unconditionally: `max_tokens` here can reach 128k, and a
 * non-streaming request that large risks an HTTP timeout. Streaming also lets
 * partial text reach the canvas while the node is still running.
 */
export const executeLlm: NodeExecutor = async ({
  config,
  input,
  outputs,
  signal,
  onDelta,
}) => {
  const modelId = String(config.model ?? DEFAULT_MODEL);
  if (!isKnownModel(modelId)) {
    throw new NodeExecutionError(`Unknown model "${modelId}".`);
  }
  const capabilities = getModel(modelId);

  // `input` in a template refers to whatever arrived on this node's edges.
  const scope = scopeFor(outputs, input.value);
  const prompt = resolveTemplate(String(config.prompt ?? ""), scope).trim();
  if (!prompt) {
    throw new NodeExecutionError("The prompt is empty.");
  }
  const system = resolveTemplate(String(config.system ?? ""), scope).trim();

  const params: Anthropic.MessageCreateParamsStreaming = {
    model: modelId,
    max_tokens: clampTokens(config.maxTokens),
    messages: [{ role: "user", content: prompt }],
    stream: true,
  };
  if (system) params.system = system;
  // Only send parameters this model accepts — an unsupported one is a 400.
  if (capabilities.adaptiveThinking) params.thinking = { type: "adaptive" };
  if (capabilities.effort) {
    params.output_config = { effort: String(config.effort ?? "high") as "high" };
  }

  let message: Anthropic.Message;
  try {
    const stream = getClient().messages.stream(params, { signal });
    stream.on("text", (delta) => onDelta?.(delta));
    message = await stream.finalMessage();
  } catch (error) {
    if (signal.aborted) throw new NodeExecutionError("Run cancelled.");
    throw new NodeExecutionError(describe(error));
  }

  // A refusal is a 200 with no usable content — check before reading it.
  if (message.stop_reason === "refusal") {
    const category = message.stop_details?.category;
    throw new NodeExecutionError(
      `The model declined this request${category ? ` (${category})` : ""}.`,
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  return {
    output: {
      text,
      model: message.model,
      stopReason: message.stop_reason,
      // Surfaced so a run's cost is visible without leaving the canvas.
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      // Flagged rather than thrown: the text is real, just cut short.
      truncated: message.stop_reason === "max_tokens",
    },
  };
};
