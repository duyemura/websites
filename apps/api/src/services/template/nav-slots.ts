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

function isProgramsParent(item: NavItem): boolean {
  return normalizeHref(item.href) === "/programs" || normalizeHref(item.label) === "programs";
}

function programSlugFromHref(href: string): string | null {
  if (!href.startsWith("/programs/")) return null;
  const slug = href.slice("/programs/".length).split("/")[0];
  return slug || null;
}

/**
 * Drop captured program links that have no generated program page.
 * Preserves owner-defined structure — never inserts a new Programs dropdown.
 */
function dropStaleProgramLinks(
  items: NavItem[],
  programSlugs: Set<string>,
): NavItem[] {
  const cleaned: NavItem[] = [];
  for (const item of items) {
    const slug = programSlugFromHref(item.href);
    if (slug && !programSlugs.has(slug)) continue; // stale /programs/* link

    cleaned.push({
      ...item,
      children: item.children ? dropStaleProgramLinks(item.children, programSlugs) : undefined,
    });
  }
  return cleaned;
}

/**
 * Reconcile captured program links against the generated program pages.
 *
 * The generated site only has Astro pages for slugs that exist in `programs`,
 * so any captured `/programs/{slug}` link whose slug isn't generated would 404.
 * This keeps owner labels when they map to a real program slug, drops stale links,
 * and ensures the Programs dropdown contains only pages that actually exist.
 */
function reconcileProgramLinks(
  items: NavItem[],
  programs: Array<{ slug: string; name: string }>,
): NavItem[] {
  if (programs.length === 0) {
    return items.filter((i) => !i.href.startsWith("/programs/"));
  }

  const programSlugs = new Set(programs.map((p) => p.slug));

  // Collect owner labels that actually match a generated program slug.
  const capturedLabels = new Map<string, string>();
  function collectLabels(list: NavItem[]) {
    for (const item of list) {
      const slug = programSlugFromHref(item.href);
      if (slug && programSlugs.has(slug)) {
        capturedLabels.set(slug, item.label);
      }
      if (item.children) collectLabels(item.children);
    }
  }
  collectLabels(items);

  const programChildren = programs.map((p) => ({
    label: capturedLabels.get(p.slug) ?? p.name,
    href: `/programs/${p.slug}`,
  }));

  let firstProgramIndex = -1;
  const cleaned: NavItem[] = [];
  let hasProgramsParent = false;

  for (const item of items) {
    if (item.href.startsWith("/programs/")) {
      if (firstProgramIndex === -1) firstProgramIndex = cleaned.length;
      continue; // drop stale /programs/* links that have no generated page
    }

    if (isProgramsParent(item)) {
      hasProgramsParent = true;
      // Owner explicitly created a Programs dropdown — preserve their structure,
      // just remove any stale children that would 404.
      cleaned.push({
        ...item,
        children: item.children ? dropStaleProgramLinks(item.children, programSlugs) : programChildren,
      });
    } else {
      cleaned.push({
        ...item,
        children: item.children ? reconcileProgramLinks(item.children, programs) : undefined,
      });
    }
  }

  if (!hasProgramsParent && firstProgramIndex !== -1) {
    cleaned.splice(firstProgramIndex, 0, {
      label: "Programs",
      href: "/programs",
      children: programChildren,
    });
  }

  return cleaned;
}

/**
 * Build Navigation from captured nav + program list.
 *
 * If capturedNav is provided (from nav-structure.json), those labels and hierarchy
 * are used as-is — the owner's words, their structure.
 *
 * If capturedNav is empty (first run before clone), infers from content page types.
 * Never hardcodes page names — derives labels from original path slugs.
 */
export function buildNavigation(
  capturedNav: CapturedNavItem[],
  programs: Array<{ slug: string; name: string }>,
  contentBriefs: Array<{ path: string; pageType: string }> = [],
): Navigation {
  const types = new Set(contentBriefs.map((b) => b.pageType));
  const hasLegalPage = contentBriefs.some((b) => b.pageType === "legal");

  // ── Header ──────────────────────────────────────────────────────────────────
  let header: NavItem[];

  if (capturedNav.length > 0) {
    // Use the gym's real nav structure — labels, hierarchy, and order preserved exactly.
    // Then normalize: merge duplicate hrefs and reconcile program links so every
    // dropdown entry points to a generated page.
    header = reconcileProgramLinks(dedupeNavItems(convertNavItems(capturedNav)), programs);
  } else {
    // Fallback: infer from content page types, labels from original path slugs
    header = [{ label: "Home", href: "/" }];
    if (programs.length > 0) {
      header.push({
        label: "Programs",
        href: "/programs",
        children: programs.map((p) => ({ label: p.name, href: `/programs/${p.slug}` })),
      });
    }
    for (const { type, templateHref } of [
      { type: "schedule", templateHref: "/schedule" },
      { type: "pricing", templateHref: "/pricing" },
      { type: "about", templateHref: "/about" },
      { type: "contact", templateHref: "/contact" },
    ]) {
      if (!types.has(type)) continue;
      const originalPath = contentBriefs.find((b) => b.pageType === type)?.path ?? templateHref;
      const slug = originalPath.replace(/^\//, "").split("/")[0] ?? type;
      const label = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      header.push({ label, href: templateHref });
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  // Derive footer links from the header — labels always match what the gym calls their pages.
  const footerCompanyLinks = header
    .filter((i) => i.href !== "/") // skip Home
    .map((i) => ({ label: i.label, href: i.href }));

  // Only link to a privacy policy if the site actually generated one.
  if (hasLegalPage) {
    footerCompanyLinks.push({ label: "Privacy Policy", href: "/legal/privacy-policy" });
  }

  const footer: FooterGroup[] = [
    {
      label: "Programs",
      links: programs.slice(0, 4).map((p) => ({ label: p.name, href: `/programs/${p.slug}` })),
    },
    { label: "Company", links: footerCompanyLinks },
  ];

  return { header, footer };
}
