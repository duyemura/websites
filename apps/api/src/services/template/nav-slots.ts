/**
 * Shared nav builder — converts captured nav from nav-structure.json into
 * the GymSiteContent Navigation shape used by all templates.
 *
 * Used by both the generate stage (full pipeline) and the nav-rebuild stage
 * (nav-only fast rebuild without LLM or re-clone).
 */

import type { Navigation, NavItem, FooterGroup } from "@ploy-gyms/shared-types";

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
  if (lower.includes("pricing") || lower.includes("membership")) return "/pricing";
  if (lower.includes("about")) return "/about";
  if (lower.includes("contact")) return "/contact";
  if (lower.includes("schedule") || lower.includes("class")) return "/schedule";
  if (lower.includes("blog") || lower.includes("news") || lower.includes("article")) return "/blog";
  if (lower.includes("guide") || lower.includes("local")) return "/local-guide";
  if (lower.startsWith("/programs/")) return lower;
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

  // ── Header ──────────────────────────────────────────────────────────────────
  let header: NavItem[];

  if (capturedNav.length > 0) {
    // Use the gym's real nav structure — labels, hierarchy, and order preserved exactly
    header = convertNavItems(capturedNav);
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
  footerCompanyLinks.push({ label: "Privacy Policy", href: "/legal/privacy-policy" });

  const footer: FooterGroup[] = [
    {
      label: "Programs",
      links: programs.slice(0, 4).map((p) => ({ label: p.name, href: `/programs/${p.slug}` })),
    },
    { label: "Company", links: footerCompanyLinks },
  ];

  return { header, footer };
}
