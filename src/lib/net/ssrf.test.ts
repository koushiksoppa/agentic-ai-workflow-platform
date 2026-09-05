import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const { blockedIpReason, checkOutboundUrl, redactUrl } = await import("./ssrf");

beforeEach(() => {
  lookupMock.mockReset();
  delete process.env.ALLOW_PRIVATE_NETWORK_REQUESTS;
});

afterEach(() => {
  delete process.env.ALLOW_PRIVATE_NETWORK_REQUESTS;
});

describe("blockedIpReason — IPv4", () => {
  it.each([
    ["127.0.0.1", /loopback/],
    ["127.1.2.3", /loopback/],
    ["10.0.0.1", /private/],
    ["192.168.1.1", /private/],
    ["172.16.0.1", /private/],
    ["172.31.255.255", /private/],
    ["169.254.169.254", /metadata/],
    ["100.64.0.1", /carrier-grade/],
    ["0.0.0.0", /unspecified/],
    ["224.0.0.1", /multicast/],
    ["240.0.0.1", /reserved/],
    ["198.18.0.1", /benchmarking/],
  ])("blocks %s", (address, expected) => {
    expect(blockedIpReason(address)).toMatch(expected);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.0.1"])(
    "allows public address %s",
    (address) => {
      expect(blockedIpReason(address)).toBeNull();
    },
  );
});

describe("blockedIpReason — IPv6", () => {
  it.each([
    ["::1", /loopback/],
    ["fe80::1", /link-local/],
    ["fc00::1", /unique local/],
    ["fd12:3456::1", /unique local/],
    ["ff02::1", /multicast/],
  ])("blocks %s", (address, expected) => {
    expect(blockedIpReason(address)).toMatch(expected);
  });

  it("sees through an IPv4-mapped address", () => {
    // ::ffff:127.0.0.1 reaches loopback despite looking like IPv6.
    expect(blockedIpReason("::ffff:127.0.0.1")).toMatch(/loopback/);
    expect(blockedIpReason("::ffff:10.0.0.1")).toMatch(/private/);
  });

  it("allows a public IPv6 address", () => {
    expect(blockedIpReason("2606:4700:4700::1111")).toBeNull();
  });
});

describe("checkOutboundUrl", () => {
  it("rejects a non-HTTP protocol", async () => {
    const result = await checkOutboundUrl(new URL("ftp://example.com/x"));
    expect(result).toEqual({ ok: false, reason: 'unsupported protocol "ftp:"' });
  });

  it("rejects credentials embedded in the URL", async () => {
    const result = await checkOutboundUrl(new URL("https://user:secret@example.com/"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/credentials/);
  });

  it("rejects localhost by name without needing DNS", async () => {
    const result = await checkOutboundUrl(new URL("http://localhost:3000/admin"));
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each(["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/"])(
    "rejects the IP literal in %s",
    async (url) => {
      const result = await checkOutboundUrl(new URL(url));
      expect(result.ok).toBe(false);
    },
  );

  it.each([".local", ".internal", ".localhost"])("rejects the %s suffix", async (suffix) => {
    const result = await checkOutboundUrl(new URL(`http://service${suffix}/`));
    expect(result.ok).toBe(false);
  });

  it("allows a public IP literal", async () => {
    expect(await checkOutboundUrl(new URL("https://8.8.8.8/"))).toEqual({ ok: true });
  });

  it("allows a hostname resolving to a public address", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34" }]);
    expect(await checkOutboundUrl(new URL("https://example.com/api"))).toEqual({ ok: true });
  });

  it("rejects a hostname resolving to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "10.1.2.3" }]);
    const result = await checkOutboundUrl(new URL("https://intranet.example.com/"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/10\.1\.2\.3/);
  });

  it("rejects when any resolved address is private, not just the first", async () => {
    // A split-horizon name should not slip through on its public record.
    lookupMock.mockResolvedValue([{ address: "93.184.216.34" }, { address: "192.168.0.5" }]);
    const result = await checkOutboundUrl(new URL("https://mixed.example.com/"));
    expect(result.ok).toBe(false);
  });

  it("rejects a hostname that does not resolve", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    const result = await checkOutboundUrl(new URL("https://nope.example.com/"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/could not resolve/);
  });

  it("honours the local development escape hatch", async () => {
    process.env.ALLOW_PRIVATE_NETWORK_REQUESTS = "true";
    expect(await checkOutboundUrl(new URL("http://localhost:8080/"))).toEqual({ ok: true });
  });

  it("still rejects a bad protocol even with the escape hatch on", async () => {
    process.env.ALLOW_PRIVATE_NETWORK_REQUESTS = "true";
    const result = await checkOutboundUrl(new URL("file:///etc/passwd"));
    expect(result.ok).toBe(false);
  });
});

describe("redactUrl", () => {
  it("drops the query string, which routinely carries API keys", () => {
    expect(redactUrl(new URL("https://api.example.com/v1/items?api_key=secret"))).toBe(
      "https://api.example.com/v1/items",
    );
  });

  it("drops embedded credentials", () => {
    expect(redactUrl(new URL("https://user:pw@api.example.com/path"))).toBe(
      "https://api.example.com/path",
    );
  });
});
