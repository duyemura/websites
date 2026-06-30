import { z } from "zod";

/**
 * Validates that a string is an HTTP(S) URL. Rejects file://, data:, javascript:,
 * and other non-web schemes to prevent server-side requests to local resources.
 */
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const INTERNAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

/**
 * Returns true if the URL points to a private, loopback, or otherwise internal
 * address that should not be reached when fetching user-discovered third-party
 * assets. This is a best-effort guard; production egress should also run behind
 * a restrictive proxy if available.
 */
export function isInternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (INTERNAL_HOSTS.has(hostname)) return true;
    if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return true;

    // IPv4 private ranges
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const octets = ipv4Match.slice(1).map(Number);
      if (octets.length !== 4 || octets.some((v) => Number.isNaN(v))) {
        return true;
      }
      const a = octets[0]!;
      const b = octets[1]!;
      const c = octets[2]!;
      const d = octets[3]!;
      if (
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a === 127 ||
        a === 0 ||
        a >= 224
      ) {
        return true;
      }
      if ([a, b, c, d].some((v) => v > 255)) return true;
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Zod schema for an HTTP(S) URL. Use this for any URL that will be loaded by
 * server-side browsers, fetch clients, or scrapers.
 */
export const HttpUrlSchema = z.string().refine(isHttpUrl, {
  message: "URL must use http:// or https://",
});
