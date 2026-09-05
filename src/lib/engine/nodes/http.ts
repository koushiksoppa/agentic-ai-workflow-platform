import { checkOutboundUrl, redactUrl } from "@/lib/net/ssrf";
import {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
} from "@/lib/nodes/http-config";
import { resolveTemplate, scopeFor } from "../template";
import { NodeExecutionError, type NodeExecutor } from "../types";

export { DEFAULT_TIMEOUT_MS, MAX_RESPONSE_BYTES, MAX_TIMEOUT_MS, MIN_TIMEOUT_MS };

/** Redirects are followed manually so each hop can be re-validated. */
const MAX_REDIRECTS = 5;

const METHODS_WITHOUT_BODY = new Set(["GET", "HEAD"]);

/**
 * Response headers carrying credentials or session material. They are dropped
 * rather than returned, so a workflow cannot funnel them into a prompt, a
 * stored run record, or a subsequent request.
 */
const REDACTED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "authorization",
  "proxy-authenticate",
  "www-authenticate",
]);

export function clampTimeout(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.trunc(n)));
}

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

export function safeResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!REDACTED_RESPONSE_HEADERS.has(key.toLowerCase())) result[key] = value;
  });
  return result;
}

function parseUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new NodeExecutionError(`"${raw}" is not a valid URL.`);
  }
}

async function assertAllowed(url: URL): Promise<void> {
  const verdict = await checkOutboundUrl(url);
  if (!verdict.ok) {
    throw new NodeExecutionError(`Blocked request to ${redactUrl(url)}: ${verdict.reason}.`);
  }
}

/** Reads at most `limit` bytes, so a huge response cannot exhaust memory. */
export async function readCapped(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new NodeExecutionError(`Response is ${declared} bytes, over the ${limit} byte limit.`);
  }

  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        throw new NodeExecutionError(`Response exceeded the ${limit} byte limit.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Calls an external endpoint. URL, headers, and body all support templates.
 *
 * Every destination is validated before the request, and again on each
 * redirect hop — otherwise a public URL could redirect the server straight to
 * an internal address, which is exactly what following redirects blindly
 * would allow.
 */
export const executeHttp: NodeExecutor = async ({ config, input, outputs, signal }) => {
  const scope = scopeFor(outputs, input.value);
  const method = String(config.method ?? "GET").toUpperCase();
  const rawUrl = resolveTemplate(String(config.url ?? ""), scope).trim();

  if (!rawUrl) {
    throw new NodeExecutionError("No URL configured.");
  }

  const timeoutMs = clampTimeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = parseHeaders(resolveTemplate(String(config.headers ?? ""), scope));
  const body = resolveTemplate(String(config.body ?? ""), scope);
  const sendsBody = !METHODS_WITHOUT_BODY.has(method) && body.trim().length > 0;

  if (sendsBody && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }

  // One timeout budget for the whole chain, redirects included.
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);

  let target = parseUrl(rawUrl);
  let response: Response;
  let redirects = 0;

  for (;;) {
    await assertAllowed(target);

    try {
      response = await fetch(target, {
        method,
        headers,
        body: sendsBody ? body : undefined,
        signal: combined,
        // Manual, so each hop's destination is checked before it is followed.
        redirect: "manual",
      });
    } catch (error) {
      if (timeout.aborted) {
        throw new NodeExecutionError(`Request timed out after ${timeoutMs / 1000}s.`);
      }
      if (signal.aborted) {
        throw new NodeExecutionError("Run cancelled.");
      }
      throw new NodeExecutionError(
        `Request to ${redactUrl(target)} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      if (++redirects > MAX_REDIRECTS) {
        throw new NodeExecutionError(`Too many redirects (over ${MAX_REDIRECTS}).`);
      }
      // Release the body of the hop being abandoned.
      await response.body?.cancel().catch(() => {});
      target = parseUrl(new URL(location, target).href);
      continue;
    }

    break;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const raw = await readCapped(response, MAX_RESPONSE_BYTES);

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
      `${method} ${redactUrl(target)} responded ${response.status} ${response.statusText}`.trim(),
    );
  }

  return {
    output: {
      status: response.status,
      headers: safeResponseHeaders(response.headers),
      body: parsedBody,
    },
  };
};
