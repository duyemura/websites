import type { GymSiteContent } from "../types/gym-content";
// gym.json is written by `pnpm use:fixture` (dev/test) or the deploy runner (production builds).
import raw from "../content/gym.json";

export const content = raw as unknown as GymSiteContent;

export const geoTitle = (page: string) =>
  `${page} in ${content.business.geo.city}, ${content.business.geo.stateAbbr} | ${content.business.name}`;

export function programBySlug(slug: string) {
  const p = content.pages.programs.find((p) => p.slug === slug);
  if (!p) throw new Error(`Unknown program slug: ${slug}`);
  return p;
}

export function programGeoHeadline(p: { name: string; geoHeadline?: string }) {
  return p.geoHeadline ?? `${p.name} in ${content.business.geo.city}, ${content.business.geo.stateAbbr}`;
}

/**
 * Validate a third-party tracking ID before interpolating it into JS/HTML.
 * Tracking IDs (GTM-XXXXX, G-XXXXX, numeric pixel IDs) only contain word
 * chars and hyphens. Returns "" if the value is absent or contains anything
 * that could break out of a JS string literal or HTML attribute.
 */
export const safeTrackingId = (id: string | undefined): string =>
  id && /^[\w-]+$/.test(id.trim()) ? id.trim() : "";

/**
 * Build an absolute URL from a root-relative path.
 * Trims trailing slash from siteUrl and ensures path starts with /
 * so callers can't accidentally produce double-slashes.
 */
export function absUrl(path: string): string {
  const base = content.meta.siteUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
