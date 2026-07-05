export interface Redirect { from: string; to: string; reason: "slug-match" | "family" | "fallback" }

const norm = (p: string) => (p !== "/" && p.endsWith("/") ? p.slice(0, -1) : p);
const lastSegment = (p: string) => norm(p).split("/").filter(Boolean).pop() ?? "";

/** Family prefixes: old first-segment (or keyword) → new route, checked in order. */
const FAMILY_RULES: [RegExp, string][] = [
  [/pricing|membership/i, "/pricing"],
  [/^\/blog\//, "/blog"],
  [/^\/recipes(\/|$)/, "/blog"],
  [/^\/coaches(\/|$)/, "/about"],
  [/^\/contact/, "/contact"],
  [/schedule/i, "/schedule"],
  [/guide/i, "/local-guide"],
];

export function computeRedirects(oldPaths: string[], newRoutes: string[]): Redirect[] {
  const routes = new Set(newRoutes.map(norm));
  const bySlug = new Map<string, string>();
  for (const r of newRoutes) {
    const s = lastSegment(r);
    if (s) bySlug.set(s, norm(r)); // last write wins — fine, slugs are near-unique
  }

  const out: Redirect[] = [];
  for (const raw of oldPaths) {
    const p = norm(raw);
    if (routes.has(p)) continue;

    const slugTarget = bySlug.get(lastSegment(p));
    if (slugTarget && slugTarget !== p) {
      out.push({ from: p, to: slugTarget, reason: "slug-match" });
      continue;
    }

    const family = FAMILY_RULES.find(([re]) => re.test(p));
    if (family && routes.has(family[1])) {
      out.push({ from: p, to: family[1], reason: "family" });
      continue;
    }

    out.push({ from: p, to: "/", reason: "fallback" });
  }
  return out;
}
