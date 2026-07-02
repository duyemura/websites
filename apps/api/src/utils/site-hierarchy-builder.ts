import type { ScrapedSection, ScrapedWebsiteData } from "./scrape-docs";
import type {
  CanonicalSectionTag,
  HierarchyPage,
  HierarchySection,
  SiteHierarchy,
} from "../types/site-hierarchy";

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
    unknown: "Present the captured content in a layout faithful to the source.",
  };
  return intents[tag];
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
        items: s.items,
        images: s.images,
        cta: s.cta,
      },
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
