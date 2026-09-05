import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guards outbound HTTP requests against server-side request forgery.
 *
 * The HTTP node fetches whatever URL a workflow gives it, from the server. On
 * any real host that means the workflow can reach things the public internet
 * cannot: loopback services, private LAN addresses, and cloud instance
 * metadata endpoints that hand out credentials. This module decides whether an
 * address is safe to contact.
 */

/** Escape hatch for local development against services on localhost. */
export function privateNetworkAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_NETWORK_REQUESTS === "true";
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Suffixes that resolve inside a private network by convention. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function ipv4Reason(address: string): string | null {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return "not a valid IPv4 address";
  }
  const [a, b] = octets;

  if (a === 0) return "unspecified address";
  if (a === 10) return "private network";
  if (a === 127) return "loopback address";
  if (a === 100 && b >= 64 && b <= 127) return "carrier-grade NAT range";
  // 169.254.169.254 is the cloud instance metadata endpoint on AWS, GCP and Azure.
  if (a === 169 && b === 254) return "link-local address (cloud metadata range)";
  if (a === 172 && b >= 16 && b <= 31) return "private network";
  if (a === 192 && b === 0) return "IETF protocol assignment range";
  if (a === 192 && b === 168) return "private network";
  if (a === 198 && (b === 18 || b === 19)) return "benchmarking range";
  if (a >= 224 && a <= 239) return "multicast address";
  if (a >= 240) return "reserved address";

  return null;
}

function ipv6Reason(address: string): string | null {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms tunnel a v4 address.
  const embedded = normalized.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embedded) {
    const reason = ipv4Reason(embedded[1]);
    if (reason) return reason;
  }

  if (normalized === "::1") return "loopback address";
  if (normalized === "::") return "unspecified address";
  // fc00::/7 — unique local addresses.
  if (/^f[cd]/.test(normalized)) return "unique local address";
  // fe80::/10 — link-local.
  if (/^fe[89ab]/.test(normalized)) return "link-local address";
  if (/^ff/.test(normalized)) return "multicast address";

  return null;
}

/** Returns a human-readable reason when an IP literal must not be contacted. */
export function blockedIpReason(address: string): string | null {
  const version = isIP(address.replace(/^\[|\]$/g, ""));
  if (version === 4) return ipv4Reason(address);
  if (version === 6) return ipv6Reason(address);
  return "not a recognised IP address";
}

export type UrlCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validates a URL's destination.
 *
 * Hostnames are resolved and *every* returned address is checked, so a name
 * that resolves to both a public and a private address is still rejected.
 *
 * Known limitation: this does not pin the resolved address for the subsequent
 * connection, so a DNS entry that changes between this check and the request
 * (rebinding) is not defeated. Closing that requires connecting to the
 * validated IP directly with a custom agent, which is out of scope here; the
 * redirect re-validation in the HTTP node covers the common attack path.
 */
export async function checkOutboundUrl(url: URL): Promise<UrlCheck> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `unsupported protocol "${url.protocol}"` };
  }

  // Credentials in the URL would be sent to whatever it resolves to, and would
  // leak through any error message that echoed the URL back.
  if (url.username || url.password) {
    return { ok: false, reason: "credentials in the URL are not allowed" };
  }

  if (privateNetworkAllowed()) return { ok: true };

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `"${hostname}" is a local address` };
  }
  if (BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { ok: false, reason: `"${hostname}" resolves inside a private network` };
  }

  if (isIP(hostname) !== 0) {
    const reason = blockedIpReason(hostname);
    return reason ? { ok: false, reason: `${hostname} is a ${reason}` } : { ok: true };
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return { ok: false, reason: `could not resolve "${hostname}"` };
  }

  if (addresses.length === 0) {
    return { ok: false, reason: `"${hostname}" did not resolve to an address` };
  }

  for (const { address } of addresses) {
    const reason = blockedIpReason(address);
    if (reason) {
      return { ok: false, reason: `"${hostname}" resolves to ${address}, a ${reason}` };
    }
  }

  return { ok: true };
}

/**
 * A URL safe to put in an error message or a stored run: no credentials, and
 * no query string, which routinely carries API keys and tokens.
 */
export function redactUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}
