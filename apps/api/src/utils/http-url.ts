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

/**
 * Zod schema for an HTTP(S) URL. Use this for any URL that will be loaded by
 * server-side browsers, fetch clients, or scrapers.
 */
export const HttpUrlSchema = z.string().refine(isHttpUrl, {
  message: "URL must use http:// or https://",
});
