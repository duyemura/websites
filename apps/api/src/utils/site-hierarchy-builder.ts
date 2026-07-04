import type { ScrapedSection, ScrapedWebsiteData } from "./scrape-docs";
import type {
  CanonicalSectionTag,
  HierarchyPage,
  HierarchySection,
  PageBuildStatus,
  SiteHierarchy,
} from "../types/site-hierarchy";
import type {
  ExtractArtifact,
  ExtractPage,
  NavLink,
  SegmentArtifact,
  SegmentSection,
} from "../types/pipeline-artifacts";

function inferTag(scraped: ScrapedSection): CanonicalSectionTag {
  const type = scraped.type.toLowerCase();
  if (type.includes("hero")) return "hero";
  if (type.includes("header")) return "header";
  if (type.includes("footer")) return "footer";
  if (type.includes("cta")) return "cta-band";
  if (type.includes("card") || type.includes("plan") || type.includes("feature")) return "feature-grid";
  if (type.includes("testimonial") || type.includes("review")) return "testimonial-band";
  if (type.includes("location")) return "location-block";
  if (type.includes("faq")) return "faq-block";
  if (type.includes("step") || type.includes("process")) return "steps-band";
  if (type.includes("image") || type.includes("gallery") || type.includes("media")) return "media-block";
  if (scraped.images && scraped.images.length > 0 && (scraped.heading || scraped.body)) return "content-block";

  // Fallback: classify by heading/body content when type-based matching yields nothing.
  // This handles generic scraper types like "Text" that carry structured content.
  const heading = (scraped.heading ?? "").toLowerCase();
  const body = (scraped.body ?? "").toLowerCase();
  const combined = heading + " " + body;

  if (/\bfaq\b|frequentl|question|answer/.test(combined)) return "faq-block";
  if (/testimonial|review|real result|what (our|client|member)|said about|trust/.test(combined)) return "testimonial-band";
  if (/our (location|address|gym|studio|facility)|located|visit us|find us|where we are/.test(combined)) return "location-block";
  if (/step \d|how (it works|to (start|join|get started))|process|next step/.test(combined)) return "steps-band";
  if (/\b(download|get the) (app|application)\b/.test(combined)) return "content-block";
  if (/\b(about|philosophy|vision|mission|story|who we are|our team|instructors?|coaches?)\b/.test(combined) && body.length > 30) return "content-block";
  if ((heading || body) && (scraped.images ?? []).length > 0) return "content-block";
  if (heading && body.length > 30) return "content-block";
  // A section with image(s) but no text is a visual accent — classify as media-block rather than unknown.
  if ((scraped.images ?? []).length > 0) return "media-block";

  return "unknown";
}

function inferIntent(scraped: ScrapedSection): string {
  const tag = inferTag(scraped);
  const intents: Record<CanonicalSectionTag, string> = {
    hero: "Introduce the brand, state the core promise, and drive the primary conversion action.",
    header: "Global site navigation and brand identity.",
    footer: "Contact, legal, and secondary navigation.",
    "cta-band": "Isolate a single high-priority conversion action.",
    "content-block": "Communicate a message with text and supporting imagery.",
    "media-block": "Showcase media to set tone or demonstrate the experience.",
    "feature-grid": "Present multiple offerings or benefits in a scannable grid.",
    "testimonial-band": "Build trust through social proof.",
    "location-block": "Provide location and visit details.",
    "faq-block": "Address common objections with collapsible answers.",
    "social-proof-band": "Reinforce credibility via logos, stats, or community signals.",
    "steps-band": "Explain a process in sequential steps.",
    schedule: "Display schedule details or booking availability.",
    team: "Introduce the coaches, instructors, or team members.",
    contact: "Provide primary contact channels and next steps.",
    unknown: "Present the captured content in a layout faithful to the source.",
  };
  return intents[tag];
}

const SEGMENT_INTENTS: Record<CanonicalSectionTag, string> = {
  hero: "Introduce the brand, state the core promise, and drive the primary conversion action.",
  header: "Global site navigation and brand identity.",
  footer: "Contact, legal, and secondary navigation.",
  "cta-band": "Isolate a single high-priority conversion action.",
  "content-block": "Communicate a message with text and supporting imagery.",
  "media-block": "Showcase media to set tone or demonstrate the experience.",
  "feature-grid": "Present multiple offerings or benefits in a scannable grid.",
  "testimonial-band": "Build trust through social proof.",
  "location-block": "Provide location and visit details.",
  "faq-block": "Address common objections with collapsible answers.",
  "social-proof-band": "Reinforce credibility via logos, stats, or community signals.",
  "steps-band": "Explain a process in sequential steps.",
  schedule: "Display schedule details or booking availability.",
  team: "Introduce the coaches, instructors, or team members.",
  contact: "Provide primary contact channels and next steps.",
  unknown: "Present the captured content in a layout faithful to the source.",
};

export function intentForSegmentTag(tag: CanonicalSectionTag): string {
  return SEGMENT_INTENTS[tag];
}

export function buildSiteHierarchy(
  data: ScrapedWebsiteData,
  mode: SiteHierarchy["siteMetadata"]["mode"] = "replication",
): SiteHierarchy {
  const pageSections: HierarchySection[] =
    data.sections?.map((s) => ({
      id: s.id,
      tag: inferTag(s),
      intent: s.intent ?? inferIntent(s),
      content: {
        heading: s.heading,
        body: s.body,
        eyebrow: s.styleHint?.eyebrow,
        items: s.items,
        images: s.images,
        cta: s.cta,
      },
      styleHint: s.styleHint,
      evidenceId: s.visualEvidence.evidenceId,
    })) ?? [];

  const homePage: HierarchyPage = {
    slug: "index",
    isHomePage: true,
    title: data.businessName ?? data.title,
    metaTitle: data.title,
    metaDescription: data.description,
    primaryCta: pageSections.find((s) => s.tag === "hero")?.content.cta,
    sections: pageSections.filter((s) => s.tag !== "header" && s.tag !== "footer"),
  };

  return {
    version: "1",
    siteMetadata: {
      framework: "astro",
      mode,
      targetUrl: data.url,
      businessName: data.businessName,
      generatedAt: new Date().toISOString(),
    },
    pages: [homePage],
    buildPlan: {
      nextPage: "index",
      pageStatus: { index: "in_progress" },
      buildOrder: ["index"],
    },
  };
}

/** Convert a URL path (e.g. "/", "/about", "/programs/kids") into a slug. */
export function pathToSlug(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "index";
  return trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pickHeadingText(section: SegmentSection): string | undefined {
  if (section.headingText && section.headingText.trim()) return section.headingText;
  return undefined;
}

function bodyPreview(section: SegmentSection): string | undefined {
  const inner = section.innerText?.trim();
  if (!inner) return undefined;
  // Trim to a reasonable preview length so build prompts stay compact; the
  // full content is available via the visual evidence + shared component
  // registry.
  return inner.length > 600 ? `${inner.slice(0, 600).trim()}…` : inner;
}

/** Convert a nav href to a page slug, e.g. "/schedule" → "schedule" */
function hrefToSlug(href: string): string | null {
  if (!href || href === "#" || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) return null;
  const path = href.split("?")[0]?.split("#")[0] ?? "";
  if (!path || path === "/") return "index";
  return pathToSlug(path);
}

/** Flatten all nav links (including children) into a flat array. */
function flattenNavLinks(links: NavLink[]): NavLink[] {
  const result: NavLink[] = [];
  for (const l of links) {
    result.push(l);
    if (l.children?.length) result.push(...flattenNavLinks(l.children));
  }
  return result;
}

/** Recursively collect all slugs from nav links so the build plan includes them. */
function collectNavSlugs(links: NavLink[]): string[] {
  const slugs: string[] = [];
  for (const link of links) {
    const slug = hrefToSlug(link.href);
    if (slug) slugs.push(slug);
    if (link.children?.length) slugs.push(...collectNavSlugs(link.children));
  }
  return [...new Set(slugs)];
}

export function buildSiteHierarchyFromSegments(
  segment: SegmentArtifact,
  extract: ExtractArtifact,
  mode: SiteHierarchy["siteMetadata"]["mode"] = "replication",
): SiteHierarchy {
  const extractPageByPath = new Map<string, ExtractPage>();
  for (const p of extract.pages) extractPageByPath.set(p.path, p);

  const pages: HierarchyPage[] = segment.pages.map((sp) => {
    const slug = pathToSlug(sp.path);
    const isHomePage = sp.path === "/" || slug === "index";
    const ep = extractPageByPath.get(sp.path);
    const meta = ep?.content.meta ?? {};

    const nonShellSections = sp.sections.filter(
      (s) => s.tag !== "header" && s.tag !== "footer",
    );

    // Extract page-level headings for fallback (hero sections often have empty headingText
    // because the heading is in a complex DOM structure that the segmenter misses)
    const pageHeadings = ep?.content.headings ?? [];
    const pageH1 = pageHeadings.find(h => h.level === 1)?.text;
    const pageH2 = pageHeadings.find(h => h.level === 2)?.text;

    const hierarchySections: HierarchySection[] = nonShellSections.map((s) => {
      // For hero sections with no extracted heading, fall back to the page's H1/H2
      const headingFromSection = pickHeadingText(s);
      const heading = headingFromSection
        ?? (s.tag === "hero" ? (pageH2 ?? pageH1) : undefined);

      const section: HierarchySection = {
        id: s.id,
        tag: s.tag,
        intent: intentForSegmentTag(s.tag),
        content: {
          heading,
          body: bodyPreview(s),
          images:
            s.mediaUrls.length > 0
              ? s.mediaUrls.map((url) => ({ url }))
              : undefined,
          // CTA and eyebrow from DOM extraction — generic for any site
          cta: s.domStyles?.ctaLabel
            ? { label: s.domStyles.ctaLabel, href: s.domStyles.ctaHref ?? "#" }
            : undefined,
          eyebrow: s.domStyles?.eyebrowText ?? undefined,
        },
        evidenceId: s.id,
      };
      if (s.sharedComponentId) section.sharedComponentId = s.sharedComponentId;
      if (s.sharedProps) section.sharedProps = s.sharedProps;
      return section;
    });

    const heroSection = hierarchySections.find((h) => h.tag === "hero");
    const heroCta = heroSection?.content.cta;
    const heroImageUrl = heroSection?.content.images?.[0]?.url;

    // Infer page type from slug/path for layout selection
    const pageType = isHomePage ? "home"
      : slug.includes("contact") ? "contact"
      : slug.includes("blog") ? "blog"
      : slug.includes("schedule") ? "schedule"
      : "interior";

    return {
      slug,
      path: sp.path,
      isHomePage,
      segmented: true,
      pageType,
      title:
        ep?.content.businessName ??
        ep?.content.title ??
        (isHomePage ? "Home" : slug),
      metaTitle: ep?.content.title ?? meta["og:title"],
      metaDescription: meta["description"] ?? meta["og:description"],
      primaryCta: heroCta,
      heroImageUrl,
      sections: hierarchySections,
    };
  });

  // Ensure index is present + first in build order when a home page exists.
  const homeIndex = pages.findIndex((p) => p.isHomePage);
  const orderedPages =
    homeIndex > 0
      ? [pages[homeIndex]!, ...pages.filter((_, i) => i !== homeIndex)]
      : pages;

  const buildOrder = orderedPages.map((p) => p.slug);

  // Augment buildOrder + pages[] with all nav-linked pages not yet segmented.
  // These get stub HierarchyPage entries (segmented:false, empty sections) so:
  // - The hierarchy doc is a complete manifest of the site
  // - The build stage knows about all pages and can render stubs/redirects
  // - When a page is later fully segmented, its entry gets replaced
  if (extract.extractedNav) {
    const navSlugs = collectNavSlugs(extract.extractedNav.links);
    const existingSlugs = new Set(buildOrder);
    const allNavLinks = flattenNavLinks(extract.extractedNav.links);

    for (const slug of navSlugs) {
      if (!existingSlugs.has(slug)) {
        buildOrder.push(slug);
        existingSlugs.add(slug);
        // Add a stub page entry so the hierarchy doc covers the full site
        const navLink = allNavLinks.find(l => hrefToSlug(l.href) === slug);
        orderedPages.push({
          slug,
          path: navLink?.href ?? `/${slug}`,
          isHomePage: false,
          segmented: false,
          pageType: slug.includes("contact") ? "contact"
            : slug.includes("blog") ? "blog"
            : slug.includes("schedule") ? "schedule"
            : "interior",
          title: navLink?.label ?? slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          sections: [],
        });
      }
    }
  }

  const pageStatus: Record<string, PageBuildStatus> = {};
  for (const slug of buildOrder) {
    pageStatus[slug] = slug === "index" ? "in_progress" : "planned";
  }

  return {
    version: "1",
    siteMetadata: {
      framework: "astro",
      mode,
      targetUrl: extract.url,
      businessName: extract.pages[0]?.content.businessName,
      generatedAt: new Date().toISOString(),
    },
    pages: orderedPages,
    buildPlan: {
      nextPage: buildOrder[0] ?? "index",
      pageStatus,
      buildOrder,
    },
  };
}
