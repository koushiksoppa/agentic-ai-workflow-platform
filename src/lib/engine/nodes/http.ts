import { resolveTemplate } from "../template";
import { NodeExecutionError, type NodeExecutor } from "../types";

const REQUEST_TIMEOUT_MS = 30_000;
const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

function parseHeaders(raw: string): Record<string, string> {
  const text = raw.trim();
  if (!text) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new NodeExecutionError("Headers must be a JSON object.");
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NodeExecutionError("Headers must be a JSON object.");
  }

  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
  );
}

/** Calls an external endpoint. URL, headers, and body all support templates. */
export const executeHttp: NodeExecutor = async ({ config, outputs, signal }) => {
  const method = String(config.method ?? "GET").toUpperCase();
  const url = resolveTemplate(String(config.url ?? ""), outputs).trim();

  if (!url) {
    throw new NodeExecutionError("No URL configured.");
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new NodeExecutionError(`"${url}" is not a valid URL.`);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new NodeExecutionError(`Unsupported protocol "${target.protocol}".`);
  }

  const headers = parseHeaders(resolveTemplate(String(config.headers ?? ""), outputs));
  const body = resolveTemplate(String(config.body ?? ""), outputs);
  const sendsBody = !METHODS_WITHOUT_BODY.has(method) && body.trim().length > 0;

  if (sendsBody && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }

  // Fail the request on either an overall run cancellation or its own timeout.
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combined = AbortSignal.any([signal, timeout]);

  let response: Response;
  try {
    response = await fetch(target, {
      method,
      headers,
      body: sendsBody ? body : undefined,
      signal: combined,
      redirect: "follow",
    });
  } catch (error) {
    if (timeout.aborted) {
      throw new NodeExecutionError(`Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    if (signal.aborted) {
      throw new NodeExecutionError("Run cancelled.");
    }
    throw new NodeExecutionError(
      `Request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  let parsedBody: unknown = raw;
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      parsedBody = JSON.parse(raw);
    } catch {
      // Server mislabelled the payload; fall back to the raw text.
    }
  }

  if (!response.ok) {
    throw new NodeExecutionError(
      `${method} ${target.href} responded ${response.status} ${response.statusText}`.trim(),
    );
  }

  return {
    output: {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: parsedBody,
    },
  };
};
