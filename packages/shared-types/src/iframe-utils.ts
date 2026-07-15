/**
 * Shared iframe utilities for the API and renderer.
 *
 * These helpers stay generic: they do not hardcode third-party service names.
 * They only apply loose URL-pattern hints so templates can pick sensible
 * presentation defaults. Humans or AI assistants can always override the
 * inferred variant via sites/{uuid}/config/iframes.json.
 */

import type { IframeEmbed } from "./gym-content.js";

/**
 * Infer a template iframe variant from the embed src URL.
 *
 * Variants are purely presentation hints. The template decides how to style
 * each variant, and every field can be overridden per-embed.
 */
export function inferIframeVariant(src: string): string {
  if (/google\.[^/]*\/maps|maps\.google/.test(src)) return "map";
  if (/youtube|vimeo|wistia/.test(src)) return "video";
  if (/calendly|schedule|booking/.test(src)) return "schedule";
  if (/typeform|jotform|forms\./.test(src)) return "form";
  if (/(?:reputation|trustpilot|birdeye|embedsocial|review[-_]?widget|widgets\.trustpilot)/.test(src)) return "review";
  return "default";
}

/** Validate that an iframe src uses http: or https:. */
export function isAllowedIframeSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** Sandbox tokens that let an iframe navigate the top-level page. */
const DANGEROUS_SANDBOX_TOKENS = new Set([
  "allow-top-navigation",
  "allow-top-navigation-by-user-activation",
]);

/**
 * Strip sandbox tokens that let an iframe navigate the top-level page.
 * Returns undefined if nothing remains.
 */
export function sanitizeSandbox(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const tokens = raw.split(/\s+/).filter((t) => !DANGEROUS_SANDBOX_TOKENS.has(t));
  return tokens.length > 0 ? tokens.join(" ") : undefined;
}

/** iframe feature policies we allow third-party widgets to request. */
const ALLOWED_PERMISSIONS = new Set([
  "autoplay",
  "encrypted-media",
  "picture-in-picture",
  "fullscreen",
  "clipboard-write",
  "web-share",
]);

/**
 * Strip iframe feature policies we don't want third-party widgets to request
 * (camera, microphone, geolocation, etc.). Returns undefined if nothing
 * remains.
 */
export function sanitizeAllow(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const keep = raw
    .split(/[;,]\s*/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => ALLOWED_PERMISSIONS.has(p));
  return keep.length > 0 ? [...new Set(keep)].join("; ") : undefined;
}

/** Inline style properties we allow on the iframe element. URLs are stripped. */
const ALLOWED_STYLE_PROPS = new Set([
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "border",
  "border-radius",
  "display",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
]);

/**
 * Allow only safe inline style properties on the iframe element. Any value
 * containing url(...) is dropped because it can exfiltrate visitor data.
 */
export function sanitizeStyle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const safe: string[] = [];
  for (const part of raw.split(";")) {
    const colonIndex = part.indexOf(":");
    if (colonIndex === -1) continue;
    const prop = part.slice(0, colonIndex).trim().toLowerCase();
    const value = part.slice(colonIndex + 1).trim();
    if (ALLOWED_STYLE_PROPS.has(prop) && !/url\(/i.test(value)) {
      safe.push(`${prop}: ${value}`);
    }
  }
  return safe.length > 0 ? safe.join("; ") : undefined;
}

/** Upgrade http iframe embeds to https for the rendered production site. */
export function upgradeToHttps(src: string): string {
  return src.replace(/^http:\/\//i, "https://");
}

/** Apply all production safety transformations to an iframe embed. */
export function sanitizeIframe(embed: IframeEmbed): IframeEmbed {
  return {
    ...embed,
    src: upgradeToHttps(embed.src),
    sandbox: sanitizeSandbox(embed.sandbox),
    allow: sanitizeAllow(embed.allow),
    style: sanitizeStyle(embed.style),
  };
}
