import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const {
  clampTimeout,
  executeHttp,
  readCapped,
  safeResponseHeaders,
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
} = await import("./http");

const fetchMock = vi.fn();

function ctx(config: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    nodeId: "http_1",
    config,
    input: { bySource: {}, value: undefined },
    outputs: {},
    signal: new AbortController().signal,
    ...extra,
  } as Parameters<typeof executeHttp>[0];
}

const BASE = { method: "GET", url: "https://api.example.com/items", headers: "{}", body: "" };

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  lookupMock.mockReset();
  // Every hostname resolves to a public address unless a test says otherwise.
  lookupMock.mockResolvedValue([{ address: "93.184.216.34" }]);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("clampTimeout", () => {
  it("keeps a value inside the supported range", () => {
    expect(clampTimeout(5000)).toBe(5000);
  });

  it("clamps out-of-range values instead of rejecting them", () => {
    expect(clampTimeout(1)).toBe(1000);
    expect(clampTimeout(10_000_000)).toBe(120_000);
  });

  it("falls back to the default when the value is not a number", () => {
    expect(clampTimeout("soon")).toBe(DEFAULT_TIMEOUT_MS);
    expect(clampTimeout(undefined)).toBe(DEFAULT_TIMEOUT_MS);
  });
});

describe("safeResponseHeaders", () => {
  it("drops credential-bearing headers", () => {
    const headers = new Headers({
      "content-type": "application/json",
      "set-cookie": "session=abc123",
      "www-authenticate": "Bearer realm=x",
    });
    const safe = safeResponseHeaders(headers);
    expect(safe["content-type"]).toBe("application/json");
    expect(safe["set-cookie"]).toBeUndefined();
    expect(safe["www-authenticate"]).toBeUndefined();
  });
});

describe("readCapped", () => {
  it("reads a small body whole", async () => {
    expect(await readCapped(new Response("hello"), 1000)).toBe("hello");
  });

  it("rejects a body that declares itself too large", async () => {
    const response = new Response("x", { headers: { "content-length": "999999999" } });
    await expect(readCapped(response, 100)).rejects.toThrow(/over the 100 byte limit/);
  });

  it("rejects a body that exceeds the cap while streaming", async () => {
    // No content-length, so the limit can only be enforced during the read.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(200)));
        controller.close();
      },
    });
    await expect(readCapped(new Response(stream), 100)).rejects.toThrow(/exceeded/);
  });
});

describe("executeHttp — request safety", () => {
  it("blocks a loopback URL before making any request", async () => {
    await expect(executeHttp(ctx({ ...BASE, url: "http://127.0.0.1/admin" }))).rejects.toThrow(
      /Blocked request/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks the cloud metadata endpoint", async () => {
    await expect(
      executeHttp(ctx({ ...BASE, url: "http://169.254.169.254/latest/meta-data/" })),
    ).rejects.toThrow(/metadata/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.1.10" }]);
    await expect(
      executeHttp(ctx({ ...BASE, url: "https://intranet.example.com/" })),
    ).rejects.toThrow(/Blocked request/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak the query string into the error message", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.1" }]);
    await expect(
      executeHttp(ctx({ ...BASE, url: "https://intranet.example.com/x?api_key=SUPERSECRET" })),
    ).rejects.toThrow(/^(?!.*SUPERSECRET).*$/);
  });

  it("rejects an unconfigured URL", async () => {
    await expect(executeHttp(ctx({ ...BASE, url: "  " }))).rejects.toThrow(/No URL configured/);
  });

  it("rejects malformed headers", async () => {
    await expect(executeHttp(ctx({ ...BASE, headers: "not json" }))).rejects.toThrow(
      /Headers must be a JSON object/,
    );
  });
});

describe("executeHttp — redirects", () => {
  it("re-validates each hop and blocks a redirect into a private address", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );
    await expect(executeHttp(ctx(BASE))).rejects.toThrow(/Blocked request/);
    // The first hop happened; the second was refused before leaving the process.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect to another public address", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://api.example.com/v2" } }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const result = await executeHttp(ctx(BASE));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((result.output as { body: unknown }).body).toEqual({ ok: true });
  });

  it("gives up on a redirect loop", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://api.example.com/loop" } }),
    );
    await expect(executeHttp(ctx(BASE))).rejects.toThrow(/Too many redirects/);
  });
});

describe("executeHttp — responses", () => {
  it("parses a JSON body and returns the status", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: [1, 2] }));
    const result = await executeHttp(ctx(BASE));
    expect(result.output).toMatchObject({ status: 200, body: { items: [1, 2] } });
  });

  it("keeps a mislabelled JSON payload as text rather than failing", async () => {
    fetchMock.mockResolvedValue(
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const result = await executeHttp(ctx(BASE));
    expect((result.output as { body: unknown }).body).toBe("not json");
  });

  it("strips credential-bearing headers from the returned output", async () => {
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "session=secret" },
      }),
    );
    const result = await executeHttp(ctx(BASE));
    const headers = (result.output as { headers: Record<string, string> }).headers;
    expect(headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(result.output)).not.toContain("session=secret");
  });

  it("fails on a non-2xx status without echoing the query string", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500, statusText: "Server Error" }));
    await expect(
      executeHttp(ctx({ ...BASE, url: "https://api.example.com/items?token=LEAKME" })),
    ).rejects.toThrow(/^(?!.*LEAKME).*responded 500/);
  });

  it("sends a body with a default content type on POST", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await executeHttp(ctx({ ...BASE, method: "POST", body: '{"a":1}' }));
    const init = fetchMock.mock.calls[0][1];
    expect(init.body).toBe('{"a":1}');
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.redirect).toBe("manual");
  });

  it("omits a body on GET even when one is configured", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await executeHttp(ctx({ ...BASE, method: "GET", body: "ignored" }));
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("resolves templates in the URL and body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    await executeHttp(
      ctx(
        {
          ...BASE,
          method: "POST",
          url: "https://api.example.com/{{input.id}}",
          body: "{{input.id}}",
        },
        { input: { bySource: {}, value: { id: "42" } } },
      ),
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.example.com/42");
    expect(fetchMock.mock.calls[0][1].body).toBe("42");
  });

  it("refuses a response larger than the cap", async () => {
    fetchMock.mockResolvedValue(
      new Response("x", {
        status: 200,
        headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
      }),
    );
    await expect(executeHttp(ctx(BASE))).rejects.toThrow(/byte limit/);
  });

  it("reports cancellation as cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new Error("aborted"));
    await expect(executeHttp(ctx(BASE, { signal: controller.signal }))).rejects.toThrow(
      /Run cancelled/,
    );
  });
});
