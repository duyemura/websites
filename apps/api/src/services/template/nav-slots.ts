/**
 * Shared nav builder — converts captured nav from nav-structure.json into
 * the GymSiteContent Navigation shape used by all templates.
 *
 * Used by both the generate stage (full pipeline) and the nav-rebuild stage
 * (nav-only fast rebuild without LLM or re-clone).
 */

import type { Navigation, NavItem, FooterGroup } from "@milo/shared-types";

export interface CapturedNavItem {
  label: string;
  href: string;
  children?: CapturedNavItem[];
}

// Template routes the Astro renderer can handle.
// When an original site href doesn't match, we map to the closest template route.
const TEMPLATE_ROUTES: Record<string, string> = {
  "/": "/",
  "/about": "/about",
  "/contact": "/contact",
  "/pricing": "/pricing",
  "/schedule": "/schedule",
  "/blog": "/blog",
  "/programs": "/programs",
  "/local-guide": "/local-guide",
};

/**
 * Map an original site href to the closest Astro template route.
 * Keeps the label from the original nav — only changes the destination.
 * e.g. "/membership-pricing" → "/pricing", "/crossfit-classes" → "/programs/crossfit-classes"
 */
export function mapToTemplateRoute(href: string): string {
  if (!href || href === "/") return "/";
  const lower = href.toLowerCase().replace(/\/$/, "");
  if (TEMPLATE_ROUTES[lower]) return TEMPLATE_ROUTES[lower];
  // Program detail pages must keep their full path even if the slug contains
  // words like "class" or "schedule" that would otherwise map to /schedule.
  if (lower.startsWith("/programs/")) return lower;
  if (lower.includes("pricing") || lower.includes("membership")) return "/pricing";
  if (lower.includes("about")) return "/about";
  if (lower.includes("contact")) return "/contact";
  if (lower.includes("schedule") || lower.includes("class")) return "/schedule";
  if (lower.includes("blog") || lower.includes("news") || lower.includes("article")) return "/blog";
  if (lower.includes("guide") || lower.includes("local")) return "/local-guide";
  // Any other path: keep original — template redirect will handle it if needed
  return href;
}

/**
 * Convert raw captured nav items to typed NavItems, mapping hrefs to template routes.
 * Filters out utility items (login, account, etc.) that don't belong in the gym nav.
 */
export function convertNavItems(items: CapturedNavItem[]): NavItem[] {
  return items
    .filter((i) => i.label && !/(login|sign in|sign up|my account|account|search|cart)/i.test(i.label))
    .map((i) => ({
      label: i.label,
      href: mapToTemplateRoute(i.href),
      ...(i.children?.length ? { children: convertNavItems(i.children) } : {}),
    }));
}

function isExternalOrAnchor(href: string): boolean {
  return /^(https?:|mailto:|tel:|#|\/\/)/i.test(href);
}

function normalizedPath(href: string): string {
  return href.toLowerCase().replace(/\/+$/, "") || "/";
}

function topLevelFallback(href: string): string | null {
  const parts = href.split("/").filter(Boolean);
  if (parts.length <= 1) return null;
  return `/${parts[0]}`;
}

/**
 * Reconcile every nav/footer link against the routes the current template build
 * actually generates. External URLs, mailto/tel, and anchors are preserved.
 * Unknown internal links are remapped to the closest top-level page if possible,
 * otherwise dropped with a warning.
 */
export function sanitizeNavigationLinks(
  navigation: Navigation,
  allowedPaths: Set<string>,
  warnings: string[],
): Navigation {
  const sanitizeItem = (item: NavItem): NavItem | null => {
    if (isExternalOrAnchor(item.href)) return item;

    const mapped = normalizedPath(mapToTemplateRoute(item.href));
    const href = mapped;
    if (!allowedPaths.has(href)) {
      const fallback = topLevelFallback(href);
      if (fallback && allowedPaths.has(fallback)) {
        warnings.push(`nav link "${item.label}" ${item.href} → ${fallback}`);
        return { ...item, href: fallback };
      }
      warnings.push(`nav link "${item.label}" ${item.href} dropped — no matching page`);
      return null;
    }

    const children = item.children
      ?.map(sanitizeItem)
      .filter((i): i is NavItem => i !== null);
    return { ...item, href, ...(children?.length ? { children } : {}) };
  };

  const header = navigation.header
    .map(sanitizeItem)
    .filter((i): i is NavItem => i !== null);

  const footer: FooterGroup[] = navigation.footer
    .map((group) => ({
      ...group,
      links: group.links
        .map((link) => {
          if (isExternalOrAnchor(link.href)) return link;
          const mapped = normalizedPath(mapToTemplateRoute(link.href));
          if (!allowedPaths.has(mapped)) {
            const fallback = topLevelFallback(mapped);
            if (fallback && allowedPaths.has(fallback)) {
              warnings.push(`footer link "${link.label}" ${link.href} → ${fallback}`);
              return { ...link, href: fallback };
            }
            warnings.push(`footer link "${link.label}" ${link.href} dropped — no matching page`);
            return null;
          }
          return { ...link, href: mapped };
        })
        .filter((l): l is { label: string; href: string } => l !== null),
    }))
    .filter((g) => g.links.length > 0);

  return { ...navigation, header, footer };
}

function normalizeHref(href: string): string {
  return href
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/\/+$/, "") || "/";
}

function dedupeNavItems(items: NavItem[]): NavItem[] {
  const seen = new Set<string>();
  const result: NavItem[] = [];
  for (const item of items) {
    const key = normalizeHref(item.href);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/**
 * Remove nav links whose paths are not in the allowed set.
 * Generic — works for any link type, not just programs.
 * Children are filtered recursively; a parent with zero valid children is kept
 * only if its own href is valid.
 */
function dropInvalidLinks(items: NavItem[], allowedPaths: Set<string>): NavItem[] {
  const result: NavItem[] = [];
  for (const item of items) {
    if (isExternalOrAnchor(item.href)) { result.push(item); continue; }
    const path = normalizedPath(item.href);
    const children = item.children ? dropInvalidLinks(item.children, allowedPaths) : undefined;
    // Keep the item if its own href is valid OR it has valid children (it's a dropdown parent)
    if (allowedPaths.has(path) || (children && children.length > 0)) {
      result.push({ ...item, ...(children ? { children } : {}) });
    }
    // Otherwise: drop — avoids 404s for links whose pages weren't generated
  }
  return result;
}

/**
 * Build Navigation from captured nav + generated program slugs.
 *
 * Core principle: the gym's captured nav is the source of truth for labels,
 * hierarchy, and structure. We only sanitize hrefs to prevent 404s —
 * we never rename their items, never assume what their sections are called,
 * and never insert hardcoded labels like "Programs".
 *
 * A gym that calls their section "Services", "Plans", or "Classes" will see
 * exactly those labels. Dropdowns are preserved as-is. The logo is always
 * the home link — no "Home" nav item.
 *
 * allowedPaths: set of paths the Astro renderer will actually build. Any nav
 * link not in this set is dropped. Callers should pass the full set of
 * rendered page paths so nav never contains a link that would 404.
 */
export function buildNavigation(
  capturedNav: CapturedNavItem[],
  programs: Array<{ slug: string; name: string }>,
  contentBriefs: Array<{ path: string; pageType: string }> = [],
  allowedPaths?: Set<string>,
): Navigation {

  // Build the set of valid paths from programs + content briefs if caller
  // didn't supply an explicit set. This keeps backward compatibility.
  const validPaths = allowedPaths ?? (() => {
    const paths = new Set<string>(["/", "/about", "/contact", "/pricing", "/schedule", "/programs", "/blog", "/drop-in", "/local-guide"]);
    programs.forEach((p) => paths.add(`/programs/${p.slug}`));
    contentBriefs.forEach((b) => { if (b.path) paths.add(b.path.startsWith("/") ? b.path : `/${b.path}`); });
    return paths;
  })();

  // ── Header ──────────────────────────────────────────────────────────────────
  let header: NavItem[];

  if (capturedNav.length > 0) {
    // Use the gym's real nav — labels, hierarchy, and structure preserved exactly.
    // Convert hrefs to template routes, dedupe, then drop any link that would 404.
    header = dropInvalidLinks(
      dedupeNavItems(convertNavItems(capturedNav)),
      validPaths,
    ).filter((i) => i.href !== "/"); // logo is home
  } else {
    // No captured nav — build from content briefs whose pageType is a recognised
    // structural page type. Skip "other" and "home" — those include GitHub Pages
    // subfolder paths (/pushpress-site-modern/) that look like nav items but aren't.
    const NAV_WORTHY_TYPES = new Set(["program", "about", "contact", "pricing", "schedule", "blog", "localGuide"]);
    header = [];
    for (const brief of contentBriefs) {
      if (!brief.path || brief.path === "/" || !validPaths.has(brief.path)) continue;
      if (brief.path.endsWith("/index.html")) continue; // index.html redirects
      if (/legal|privacy|terms/i.test(brief.path)) continue;
      // Only add pages whose type is structurally meaningful — avoids GitHub Pages
      // subfolder paths (classified "other") appearing as nav items.
      if (!NAV_WORTHY_TYPES.has(brief.pageType)) continue;
      const slug = brief.path.replace(/^\//, "").split("/")[0] ?? "";
      if (!slug) continue;
      const label = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      header.push({ label, href: brief.path });
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  // Flatten header (top-level only, no duplicates) for the company link group.
  const companyLinks = header
    .filter((i) => i.href !== "/" && validPaths.has(i.href))
    .map((i) => ({ label: i.label, href: i.href }));

  companyLinks.push({ label: "Privacy Policy", href: "/legal/privacy-policy" });
  companyLinks.push({ label: "Terms of Service", href: "/legal/terms-of-service" });

  // Program links for footer — use whatever label the gym used in their nav,
  // or fall back to the generated program name if no nav label was captured.
  const capturedProgramLabels = new Map<string, string>();
  function collectCapturedLabels(items: NavItem[]) {
    for (const item of items) {
      const m = item.href.match(/^\/programs\/([^/]+)/);
      if (m?.[1]) capturedProgramLabels.set(m[1], item.label);
      if (item.children) collectCapturedLabels(item.children);
    }
  }
  collectCapturedLabels(header);

  const programLinks = programs.slice(0, 4).map((p) => ({
    label: capturedProgramLabels.get(p.slug) ?? p.name,
    href: `/programs/${p.slug}`,
  }));

  const footer: FooterGroup[] = [];
  if (programLinks.length > 0) {
    // Use the label from the captured nav's programs parent (whatever they call it)
    const programsParent = header.find((i) => normalizedPath(i.href) === "/programs");
    footer.push({ label: programsParent?.label ?? "Programs", links: programLinks });
  }
  footer.push({ label: "Company", links: companyLinks });

  return { header, footer };
}
