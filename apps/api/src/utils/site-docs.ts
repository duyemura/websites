import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import {
  generateBrandGuidelines,
  BRAND_GUIDELINES_DOC_KEY,
  BRAND_GUIDELINES_DOC_TITLE,
} from "./brand-guidelines";
import { assertAllowedDocKey } from "./doc-registry";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import { buildBrandGuidelinesInput, type ScrapedWebsiteData } from "./scrape-docs";
import { buildSiteHierarchy } from "./site-hierarchy-builder";
import { buildDesignSystemV2 } from "./design-system-builder";
import { buildSectionVisualEvidence } from "./section-visual-evidence-builder";
import { buildSiteBlueprint } from "./site-blueprint";
import {
  BLUEPRINT_DOC_KEY,
  BLUEPRINT_DOC_TITLE,
} from "./blueprint-io";
import {
  SITE_HIERARCHY_DOC_KEY,
  SITE_HIERARCHY_DOC_TITLE,
} from "./site-hierarchy-io";
import {
  DESIGN_SYSTEM_DOC_KEY,
  DESIGN_SYSTEM_DOC_TITLE,
} from "./design-system-io";
import {
  SECTION_VISUAL_EVIDENCE_DOC_KEY,
  SECTION_VISUAL_EVIDENCE_DOC_TITLE,
} from "./section-visual-evidence-io";
import type { SiteHierarchy, CanonicalSectionTag, HierarchySection, HierarchyPage } from "../types/site-hierarchy";
import type { DesignSystemV2 } from "../types/design-system-v2";
import type { SectionVisualEvidence } from "../types/section-visual-evidence";
import type { TemplateShell, SiteSection, ThemeTokens } from "@ploy-gyms/shared-types";
import { sanitizeTokens } from "./design-system";
import type { BrandLogo, HeadingStyle } from "./design-system";
import type { Config } from "../plugins/env";
import {
  extractBusinessInfoFields,
  type BusinessInfoExtractionResult,
} from "../ai/prompts/business-info-extraction";
import {
  generateSiteMemory,
  generateWorkspaceMemory,
  renderSiteMemory,
  renderWorkspaceMemory,
  SITE_MEMORY_DOC_KEY,
  SITE_MEMORY_DOC_TITLE,
  WORKSPACE_MEMORY_DOC_KEY,
  WORKSPACE_MEMORY_DOC_TITLE,
  type WorkspaceMemoryContext,
} from "./workspace-memory";

export interface GeneratedSiteDoc {
  key: string;
  title: string;
  content: string;
  source: "ai_extracted";
}

const SITE_STRATEGY_DOC_KEY = "site-strategy";
const SITE_STRATEGY_DOC_TITLE = "Site strategy";
const BUSINESS_INFO_DOC_KEY = "business-info";
const BUSINESS_INFO_DOC_TITLE = "Business info";

export interface DocGenerationContext {
  scraped: ScrapedWebsiteData;
  gmb?: GmbListing;
}

interface BusinessInfoDocContext extends DocGenerationContext {
  extracted?: BusinessInfoExtractionResult | null;
}

function validateGeneratedDocs(docs: GeneratedSiteDoc[]): void {
  for (const doc of docs) {
    assertAllowedDocKey(doc.key);
  }
}

function formatGmbHours(hours: { day: string; open?: string; close?: string; isClosed?: boolean }[]): string {
  return hours
    .map((h) => {
      const label = h.day.charAt(0) + h.day.slice(1).toLowerCase();
      if (h.isClosed || !h.open) return `${label}: Closed`;
      const close = h.close ?? "—";
      return `${label}: ${h.open}–${close}`;
    })
    .join("\n");
}

function renderExtractedBusinessInfo(extracted: BusinessInfoExtractionResult): string {
  const lines: string[] = [`# ${extracted.businessName}`, ""];

  if (extracted.tagline) {
    lines.push(`**Tagline**: ${extracted.tagline}`, "");
  }

  lines.push(`**Summary**: ${extracted.oneLineSummary}`, "");

  lines.push(
    "## Classification",
    "",
    `- **Industry / niche**: ${extracted.classification.industryNiche}`,
    `- **Service model**: ${extracted.classification.serviceModel}`,
    `- **Primary audience**: ${extracted.classification.primaryAudience}`,
    "",
  );

  const contact = extracted.contact;
  const hasContact =
    contact.phone || contact.email || contact.website || contact.googleMapsUrl || contact.socials.length > 0;
  if (hasContact) {
    lines.push("## Contact", "");
    if (contact.phone) lines.push(`- **Phone**: ${contact.phone}`);
    if (contact.email) lines.push(`- **Email**: ${contact.email}`);
    if (contact.website) lines.push(`- **Website**: ${contact.website}`);
    if (contact.googleMapsUrl) lines.push(`- **Google Maps**: ${contact.googleMapsUrl}`);
    for (const social of contact.socials) {
      lines.push(`- **${social.platform}**: ${social.url}`);
    }
    lines.push("");
  }

  if (extracted.location) {
    lines.push("## Location", "", `- **Address**: ${extracted.location.address}`, "");
    if ((extracted.location.hours ?? []).length > 0) {
      lines.push("**Hours**", "");
      for (const h of extracted.location.hours) {
        lines.push(`- ${h.day}: ${h.hours}`);
      }
      lines.push("");
    }
  }

  if (extracted.offerings.length > 0) {
    lines.push("## Offerings", "");
    for (const o of extracted.offerings) {
      const parts = [o.description, o.intendedFor ? `For: ${o.intendedFor}` : "", o.priceFrequency].filter(Boolean);
      lines.push(`- **${o.name}**${parts.length > 0 ? ` — ${parts.join(" | ")}` : ""}`);
    }
    lines.push("");
  }

  if (extracted.trustSignals) {
    const ts = extracted.trustSignals;
    const hasSignals =
      ts.gmbRating != null || ts.reviewCount != null || ts.teamCredentials.length > 0;
    if (hasSignals) {
      lines.push("## Trust signals", "");
      if (ts.gmbRating != null && ts.reviewCount != null) {
        lines.push(`- **Google rating**: ${ts.gmbRating} / 5 (${ts.reviewCount} reviews)`);
      } else if (ts.gmbRating != null) {
        lines.push(`- **Google rating**: ${ts.gmbRating} / 5`);
      }
      for (const credential of ts.teamCredentials) {
        lines.push(`- ${credential}`);
      }
      lines.push("");
    }
  }

  if (extracted.testimonials.length > 0) {
    lines.push("## Testimonials", "");
    const grouped: Record<string, { quote: string; author?: string }[]> = {};
    for (const t of extracted.testimonials) {
      const theme = t.theme || "other";
      (grouped[theme] ??= []).push({ quote: t.quote, author: t.author ?? undefined });
    }
    for (const [theme, items] of Object.entries(grouped)) {
      lines.push(`### ${theme.charAt(0).toUpperCase() + theme.slice(1)}`, "");
      for (const item of items) {
        lines.push(`> "${item.quote}"${item.author ? ` — ${item.author}` : ""}`, "");
      }
    }
  }

  if (extracted.faqs.length > 0) {
    lines.push("## FAQs", "");
    for (const f of extracted.faqs) {
      lines.push(`### ${f.question}`, "", f.answer, "");
    }
  }

  lines.push(
    "## Conversion signals",
    "",
    `- **Primary CTA**: ${extracted.conversionSignals.primaryCta}`,
    extracted.conversionSignals.offer ? `- **Offer**: ${extracted.conversionSignals.offer}` : "",
    extracted.conversionSignals.signupMethod ? `- **How to sign up**: ${extracted.conversionSignals.signupMethod}` : "",
    "",
  );

  if (extracted.messagingThemes.length > 0) {
    lines.push("## Messaging themes", "");
    for (const theme of extracted.messagingThemes) {
      lines.push(`- ${theme}`);
    }
    lines.push("");
  }

  lines.push("## Competitive angle", "", `- ${extracted.competitiveAngle}`, "");

  return lines.filter(Boolean).join("\n");
}

function makeFallbackBusinessInfoDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const { scraped, gmb } = ctx;
  const businessName = gmb?.name ?? scraped.businessName ?? scraped.title;

  const lines = [
    `# ${businessName}`,
    "",
    gmb?.editorialSummary || scraped.tagline ? `**Tagline**: ${gmb?.editorialSummary || scraped.tagline}` : "",
    gmb?.editorialSummary ? `**About**: ${gmb.editorialSummary}` : "",
    scraped.description ? `**Description**: ${scraped.description}` : "",
  ].filter(Boolean);

  const externalProfiles: { label: string; url: string }[] = [];
  if (gmb?.googleMapsUri) externalProfiles.push({ label: "Google Maps", url: gmb.googleMapsUri });
  if (gmb?.websiteUri) externalProfiles.push({ label: "Website", url: gmb.websiteUri });
  for (const social of scraped.contact?.social ?? []) {
    externalProfiles.push({ label: social.platform, url: social.url });
  }

  if (externalProfiles.length > 0) {
    lines.push("", "## External profiles", "");
    for (const p of externalProfiles) {
      lines.push(`- ${p.label}: ${p.url}`);
    }
  }

  if (gmb?.rating != null) {
    lines.push(
      "",
      "## Google Business Profile",
      "",
      `- **Rating**: ${gmb.rating} / 5${gmb.userRatingCount != null ? ` (${gmb.userRatingCount} reviews)` : ""}`,
      gmb.primaryType ? `- **Primary category**: ${gmb.primaryType}` : "",
      gmb.businessStatus ? `- **Status**: ${gmb.businessStatus}` : "",
    );
  }

  if (gmb?.address || gmb?.regularOpeningHours?.length) {
    lines.push("", "## Location", "");
    if (gmb.address) {
      const { streetNumber, streetName, city, state, postalCode } = gmb.address;
      const street = [streetNumber, streetName].filter(Boolean).join(" ");
      const parts = [street, city, state, postalCode].filter(Boolean);
      if (parts.length > 0) lines.push(`- **Address**: ${parts.join(", ")}`);
    }
    if (gmb.regularOpeningHours?.length) {
      lines.push("", "**Hours**", "");
      for (const h of formatGmbHours(gmb.regularOpeningHours).split("\n")) {
        lines.push(`- ${h}`);
      }
    }
  }

  const hasPhone = gmb?.phoneNumber || scraped.contact?.phone;
  const hasEmail = scraped.contact?.email;
  if (hasPhone || hasEmail) {
    lines.push("", "## Contact", "");
    if (gmb?.phoneNumber) lines.push(`- **Phone**: ${gmb.phoneNumber}`);
    else if (scraped.contact?.phone) lines.push(`- **Phone**: ${scraped.contact.phone}`);
    if (scraped.contact?.email) lines.push(`- **Email**: ${scraped.contact.email}`);
  }

  if (scraped.offerings.length > 0) {
    lines.push(
      "",
      "## Offerings",
      "",
      ...scraped.offerings.map((o) => {
        const parts = [o.name, o.description, o.price].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  if (scraped.locations.length > 0) {
    lines.push(
      "",
      "## Locations",
      "",
      ...scraped.locations.map((loc) => {
        const parts = [loc.name, loc.address, loc.hours].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  if (scraped.team.length > 0) {
    lines.push(
      "",
      "## Team",
      "",
      ...scraped.team.map((t) => {
        const parts = [t.name, t.role, t.bio].filter(Boolean);
        return `- ${parts.join(" — ")}`;
      }),
    );
  }

  const testimonials =
    scraped.testimonials.length > 0
      ? scraped.testimonials
      : (gmb?.reviews ?? []).map((r) => ({
          quote: r.text ?? "",
          author: r.author,
          role: undefined,
        }));

  if (testimonials.length > 0) {
    lines.push(
      "",
      "## Testimonials",
      "",
      ...testimonials.map((t) => {
        const attribution = [t.author, t.role].filter(Boolean).join(", ");
        return `> "${t.quote}"${attribution ? ` — ${attribution}` : ""}`;
      }),
    );
  }

  if (scraped.faqs.length > 0) {
    lines.push(
      "",
      "## FAQs",
      "",
      ...scraped.faqs.flatMap((f) => [`### ${f.question}`, "", f.answer, ""]),
    );
  }

  return {
    key: "business-info",
    title: "Business info",
    content: lines.filter(Boolean).join("\n"),
    source: "ai_extracted",
  };
}

async function makeBusinessInfoDoc(
  ctx: BusinessInfoDocContext,
  config?: Config,
  memoryCtx?: WorkspaceMemoryContext,
): Promise<GeneratedSiteDoc> {
  if (config && memoryCtx && ctx.extracted) {
    return {
      key: "business-info",
      title: "Business info",
      content: renderExtractedBusinessInfo(ctx.extracted),
      source: "ai_extracted",
    };
  }
  return makeFallbackBusinessInfoDoc(ctx);
}

function makeSiteStrategyDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const { scraped, gmb } = ctx;
  const businessName = gmb?.name ?? scraped.businessName ?? scraped.title;

  const navLines = scraped.navLinks.length
    ? scraped.navLinks.map((link) => `- [${link.label}](${link.href})`).join("\n")
    : "- No navigation links detected.";

  const sourceFacts: string[] = [];
  if (gmb) {
    sourceFacts.push(`Google Business Profile verified as ${gmb.name}.`);
    if (gmb.primaryType) sourceFacts.push(`Primary category: ${gmb.primaryType}.`);
    if (gmb.rating != null) sourceFacts.push(`Rating: ${gmb.rating} / 5.`);
    if (gmb.photos.length > 0) sourceFacts.push(`${gmb.photos.length} GMB photos available for asset curation.`);
  }
  if (scraped.url) sourceFacts.push(`Source website: ${scraped.url}.`);

  return {
    key: "site-strategy",
    title: "Site strategy",
    content: `# Site strategy for ${businessName}

## Goal
Build an Astro static site that accurately represents ${businessName} and gives the gym a reliable, editable foundation for future pages.

## Verified source facts

${sourceFacts.length > 0 ? sourceFacts.map((f) => `- ${f}`).join("\n") : "- No verified external sources available."}

## Source

- URL: ${scraped.url}

## Site structure

### Navigation

${navLines}

### Pages discovered

The blueprint captures the full site structure from the scan so it can be built incrementally. The homepage is always the first build; other pages stay planned until the homepage is approved.

- **Homepage** — gate page. Build first. Must include hero, social proof, and primary CTA.
- **About / Coaches** — build if team data is strong.
- **Services / Classes** — build if offerings are complex.
- **Contact / Location** — build if location or contact is unique.

Build only what the source site and business info justify. Prefer fewer, stronger pages over empty placeholders.

## Build phases

1. **Discovery** (done) — GMB listing resolved and full website scraped; all pages and assets catalogued.
2. **Blueprint** — emit a JSON site blueprint with design tokens, global shell, all planned pages, and a build plan.
3. **Build homepage** — generate Astro + Tailwind source for the homepage only.
4. **Review homepage** — human approval gate before additional pages.
5. **Build remaining pages** — use the blueprint's \`build_plan\` to generate each planned page in order.
6. **Assets / QA** — resolve remaining images, run \`astro build\`, and automated checks.
7. **Publish** — deploy the full site.

## Build plan

The blueprint JSON includes \`build_plan.next_page\` (slug to build next) and \`build_plan.page_status\` for every discovered page. On first scan, \`index\` is \`in_progress\` and every other page is \`planned\`.

## Next action

Generate the homepage from the blueprint draft, workspace memory, business info, brand guidelines, and screenshot asset.
`,
    source: "ai_extracted",
  };
}

function makeBlueprintDraftDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const blueprint = buildSiteBlueprint(ctx.scraped);
  return {
    key: BLUEPRINT_DOC_KEY,
    title: BLUEPRINT_DOC_TITLE,
    content: `# Blueprint draft

This doc holds the initial JSON blueprint derived from the scraped source site.

## Site blueprint

\`\`\`json
${JSON.stringify(blueprint, null, 2)}
\`\`\`
`,
    source: "ai_extracted",
  };
}

function makeSiteHierarchyDoc(
  ctx: DocGenerationContext,
  mode: SiteHierarchy["siteMetadata"]["mode"] = "replication",
): GeneratedSiteDoc {
  const hierarchy = buildSiteHierarchy(ctx.scraped, mode);
  return {
    key: SITE_HIERARCHY_DOC_KEY,
    title: SITE_HIERARCHY_DOC_TITLE,
    content: `# Site hierarchy\n\nThis doc holds the semantic page/section hierarchy.\n\n## Site hierarchy\n\n\`\`\`json\n${JSON.stringify(hierarchy, null, 2)}\n\`\`\`\n`,
    source: "ai_extracted",
  };
}

function makeDesignSystemDoc(
  ctx: DocGenerationContext,
  screenshotUrl?: string | null,
  mode: DesignSystemV2["siteMetadata"]["mode"] = "replication",
): GeneratedSiteDoc {
  const designSystem = buildDesignSystemV2(ctx.scraped, screenshotUrl, mode);
  return {
    key: DESIGN_SYSTEM_DOC_KEY,
    title: DESIGN_SYSTEM_DOC_TITLE,
    content: `# Design system\n\nThis doc holds the locked global design system used to build every page.\n\n## Design system\n\n\`\`\`json\n${JSON.stringify(designSystem, null, 2)}\n\`\`\`\n`,
    source: "ai_extracted",
  };
}

function makeSectionVisualEvidenceDoc(ctx: DocGenerationContext): GeneratedSiteDoc {
  const evidence = buildSectionVisualEvidence(ctx.scraped);
  return {
    key: SECTION_VISUAL_EVIDENCE_DOC_KEY,
    title: SECTION_VISUAL_EVIDENCE_DOC_TITLE,
    content: `# Section visual evidence\n\nThis doc holds per-section screenshots, computed styles, and DOM snippets used by the generic visual block renderer.\n\n## Section visual evidence\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`,
    source: "ai_extracted",
  };
}

function makeJsonDocContent(title: string, description: string, value: unknown): string {
  return `# ${title}\n\n${description}\n\n## ${title.toLowerCase()}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
}

function mapSiteSectionTypeToTag(type: string): CanonicalSectionTag {
  switch (type) {
    case "SiteHeader":
      return "header";
    case "Hero":
      return "hero";
    case "SiteFooter":
      return "footer";
    case "SiteCTA":
      return "cta-band";
    case "SiteCardGroup":
      return "feature-grid";
    case "SiteSteps":
      return "steps-band";
    case "SiteReviews":
      return "testimonial-band";
    case "SiteLocation":
      return "location-block";
    case "SiteFAQ":
      return "faq-block";
    case "Text":
    case "SiteBlock":
      return "content-block";
    case "SiteMedia":
    case "SiteGallery":
      return "media-block";
    default:
      return "unknown";
  }
}

function sectionTagIntent(tag: CanonicalSectionTag): string {
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

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCta(value: unknown): value is { label: string; href: string } {
  return value !== null && typeof value === "object" && "label" in value && "href" in value && isString(value.label) && isString(value.href);
}

function asItemArray(value: unknown): { title?: string; description?: string; imageUrl?: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map((item) => ({
      title: isString(item.title) ? item.title : undefined,
      description: isString(item.description) ? item.description : undefined,
      imageUrl: isString(item.imageUrl) ? item.imageUrl : undefined,
    }));
}

function asImageArray(value: unknown): { url: string; alt?: string; context?: string }[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is { url: string; alt?: string; context?: string } | string => {
      if (typeof item === "string") return true;
      return item !== null && typeof item === "object" && "url" in item && isString(item.url);
    })
    .map((item) =>
      typeof item === "string"
        ? { url: item }
        : { url: item.url, alt: item.alt, context: item.context },
    );
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((v): v is string => typeof v === "string");
}

function extractSectionContent(section: SiteSection): HierarchySection["content"] {
  const props = section.props;
  const content: HierarchySection["content"] = {};

  const heading = firstString(props.title, props.heading, props.headline);
  if (heading) content.heading = heading;

  const eyebrow = firstString(props.eyebrow, props.kicker, props.label);
  if (eyebrow) content.eyebrow = eyebrow;

  const body = firstString(props.body, props.subtitle, props.description);
  if (body) content.body = body;

  if (isCta(props.cta)) {
    content.cta = props.cta;
  }

  const itemArray =
    [props.cards, props.steps, props.features, props.reviews, props.items]
      .map(asItemArray)
      .find((arr) => arr.length > 0) ?? [];
  if (itemArray.length > 0) {
    content.items = itemArray;
  }

  const images = asImageArray(props.images);
  if (images.length > 0) {
    content.images = images;
  } else if (isString(props.imageUrl)) {
    content.images = [{ url: props.imageUrl }];
  } else if (isString(props.backgroundImage)) {
    content.images = [{ url: props.backgroundImage, context: "background" }];
  }

  return content;
}

function buildTemplateDesignSystem(
  shell: TemplateShell,
  siteName: string,
  screenshotUrl?: string | null,
): DesignSystemV2 {
  const tokens = sanitizeTokens(shell.theme);
  const headerSection = shell.page.sections.find((s) => s.type === "SiteHeader");
  const footerSection = shell.page.sections.find((s) => s.type === "SiteFooter");

  const navLinks = Array.isArray(headerSection?.props.navLinks)
    ? headerSection.props.navLinks
        .filter(
          (item): item is { label: string; href: string } =>
            item !== null && typeof item === "object" && isString(item.label) && isString(item.href),
        )
        .map((item) => ({ label: item.label, href: item.href }))
    : [];

  const heroSection = shell.page.sections.find((s) => s.type === "Hero");
  const homePagePrimaryCta = isCta(heroSection?.props.cta) ? heroSection.props.cta : undefined;

  const logo: BrandLogo = { type: "text", value: siteName };
  const headingStyle: HeadingStyle = { uppercase: false, bold: true };

  return {
    version: "2",
    siteMetadata: {
      framework: "astro",
      mode: "template",
      targetUrl: shell.source.url,
      businessName: siteName,
      generatedAt: new Date().toISOString(),
    },
    global: {
      tokens,
      shell: {
        header: headerSection,
        footer: footerSection,
        navLinks,
      },
      rules: {
        spacing: "Default section vertical padding derived from the template; hero uses larger vertical spacing.",
        radius: tokens.radius,
        maxWidth: "max-w-6xl with responsive gutters.",
        grid: "2–3 column grids for feature lists; single column on mobile.",
        defaultTheme: tokens.colors.background === "#0A0A0A" ? "dark" : "light",
      },
    },
    business: { name: siteName },
    brand: { logo, headingStyle },
    reference: { screenshotUrl, homePagePrimaryCta },
  };
}

function buildTemplateSiteHierarchy(
  shell: TemplateShell,
  siteName: string,
): SiteHierarchy {
  const pageSlug = shell.page.slug || "index";
  const contentSections = shell.page.sections.filter(
    (section) => section.type !== "SiteHeader" && section.type !== "SiteFooter",
  );
  const pageSections: HierarchySection[] = contentSections.map((section) => {
    const tag = mapSiteSectionTypeToTag(section.type);
    return {
      id: section.id,
      tag,
      intent: sectionTagIntent(tag),
      content: extractSectionContent(section),
      evidenceId: `template-${pageSlug}-${section.id}`,
    };
  });

  const homePage: HierarchyPage = {
    slug: pageSlug,
    isHomePage: shell.page.isHomePage,
    title: shell.page.title || siteName,
    metaTitle: shell.page.metaTitle,
    metaDescription: shell.page.metaDescription,
    primaryCta: pageSections.find((s) => s.tag === "hero")?.content.cta,
    sections: pageSections,
  };

  return {
    version: "1",
    siteMetadata: {
      framework: "astro",
      mode: "template",
      targetUrl: shell.source.url,
      businessName: siteName,
      generatedAt: new Date().toISOString(),
    },
    pages: [homePage],
    buildPlan: {
      nextPage: pageSlug,
      pageStatus: { [pageSlug]: "in_progress" },
      buildOrder: [pageSlug],
    },
  };
}

function buildEmptySectionVisualEvidence(): SectionVisualEvidence {
  return { version: "1", rows: [] };
}

export function generateSiteDocsFromTemplate(
  siteName: string,
  template: { key: string; name: string; instructions: string | null },
  shell: TemplateShell,
): GeneratedSiteDoc[] {
  const now = new Date().toISOString();
  const instructions = template.instructions ?? "No template instructions provided.";

  const siteMemory = [
    `# Site memory: ${siteName}`,
    "",
    `- **Created from template**: ${template.name} (${template.key})`,
    `- **Created at**: ${now}`,
    `- **Source URL**: ${shell.source.url}`,
    "",
    "## Template structure",
    "",
    shell.page.sections.map((s) => `- ${s.type} (${s.id})`).join("\n"),
    "",
    "## Placeholders",
    "",
    shell.placeholders.length > 0
      ? shell.placeholders.map((p) => `- **${p.key}** — ${p.label}`).join("\n")
      : "- No placeholders defined.",
  ].join("\n");

  const siteStrategy = [
    `# Site strategy: ${siteName}`,
    "",
    `Build a site using the **${template.name}** template. The template's structure and spacing were extracted from ${shell.source.url}.`,
    "",
    "## AI instructions from template",
    "",
    instructions,
    "",
    "## Build plan",
    "",
    "1. Read [[workspace-memory]] and [[brand-guidelines]].",
    "2. Use the business info below to replace every placeholder in the template.",
    "3. Preserve section order from the template unless the user asks otherwise.",
    "4. Generate real copy that matches the gym's tone, not the source website's brand.",
    "",
    "## Next action",
    "",
    "Fill out [[business-info]] with the gym's real details, then generate the homepage.",
  ].join("\n");

  const businessInfo = [
    `# Business info: ${siteName}`,
    "",
    "Fill in the details below so the AI can replace the template placeholders with real copy.",
    "",
    "## Required information",
    "",
    "- **Business name**:",
    "- **Tagline / one-liner**:",
    "- **Address**:",
    "- **Hours**:",
    "- **Phone**:",
    "- **Email**:",
    "- **Primary offerings / classes**:",
    "- **Coaches / team members**:",
    "- **Member testimonials**:",
    "",
    "## Brand notes",
    "",
    "- **Tone**: (e.g., energetic, welcoming, elite, community-focused)",
    "- **Colors**: (the template uses a neutral shell; apply brand colors from [[brand-guidelines]])",
    "- **Hero image direction**: (describe the desired main photo)",
  ].join("\n");

  const designSystem = buildTemplateDesignSystem(shell, siteName);
  const hierarchy = buildTemplateSiteHierarchy(shell, siteName);
  const evidence = buildEmptySectionVisualEvidence();

  const docs: GeneratedSiteDoc[] = [
    { key: SITE_MEMORY_DOC_KEY, title: SITE_MEMORY_DOC_TITLE, content: siteMemory, source: "ai_extracted" },
    { key: SITE_STRATEGY_DOC_KEY, title: SITE_STRATEGY_DOC_TITLE, content: siteStrategy, source: "ai_extracted" },
    { key: BUSINESS_INFO_DOC_KEY, title: BUSINESS_INFO_DOC_TITLE, content: businessInfo, source: "ai_extracted" },
    {
      key: DESIGN_SYSTEM_DOC_KEY,
      title: DESIGN_SYSTEM_DOC_TITLE,
      content: makeJsonDocContent("Design system", "This doc holds the locked global design system used to build every page.", designSystem),
      source: "ai_extracted",
    },
    {
      key: SITE_HIERARCHY_DOC_KEY,
      title: SITE_HIERARCHY_DOC_TITLE,
      content: makeJsonDocContent("Site hierarchy", "This doc holds the semantic page/section hierarchy.", hierarchy),
      source: "ai_extracted",
    },
    {
      key: SECTION_VISUAL_EVIDENCE_DOC_KEY,
      title: SECTION_VISUAL_EVIDENCE_DOC_TITLE,
      content: `# Section visual evidence\n\nThis doc holds per-section screenshots, computed styles, and DOM snippets used by the generic visual block renderer. Template mode has no captured evidence yet; reference the source screenshot in [[design-system]].reference.screenshotUrl.\n\n## Section visual evidence\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`,
      source: "ai_extracted",
    },
  ];

  validateGeneratedDocs(docs);
  return docs;
}

export function generateSiteDocsForGreenfield(
  site: { uuid: string; name: string; workspaceUuid: string },
  brandMemory: { primaryColor?: string; fontHeading?: string; fontBody?: string },
  businessInput: { businessName: string; tagline?: string; description?: string },
): GeneratedSiteDoc[] {
  const now = new Date().toISOString();

  const siteMemory = [
    `# Site memory: ${site.name}`,
    "",
    `- **Created from brand input**: greenfield`,
    `- **Created at**: ${now}`,
    `- **Workspace**: ${site.workspaceUuid}`,
    "",
    "## Site structure",
    "",
    "- Homepage (index) with placeholder hero and primary CTA.",
  ].join("\n");

  const siteStrategy = [
    `# Site strategy: ${site.name}`,
    "",
    "Build a new site from the provided brand and business details.",
    "",
    "## Build plan",
    "",
    "1. Read [[workspace-memory]] and [[brand-guidelines]].",
    "2. Expand the homepage sections below with real copy and imagery.",
    "3. Add additional pages only when the business info justifies them.",
    "",
    "## Next action",
    "",
    "Fill out [[business-info]] with the gym's real details, then generate the homepage.",
  ].join("\n");

  const businessInfo = [
    `# Business info: ${businessInput.businessName}`,
    "",
    businessInput.tagline ? `**Tagline**: ${businessInput.tagline}` : "",
    businessInput.description ? `**Description**: ${businessInput.description}` : "",
    "",
    "## Required information",
    "",
    "- **Business name**:",
    "- **Tagline / one-liner**:",
    "- **Address**:",
    "- **Hours**:",
    "- **Phone**:",
    "- **Email**:",
    "- **Primary offerings / classes**:",
    "- **Coaches / team members**:",
    "- **Member testimonials**:",
  ].filter(Boolean).join("\n");

  const greenfieldTokens: ThemeTokens = sanitizeTokens({
    colors: {
      primary: brandMemory.primaryColor ?? "#171717",
      primaryForeground: "#ffffff",
      background: "#ffffff",
      foreground: "#171717",
      muted: "#f5f5f5",
      mutedForeground: "#737373",
      border: "#e5e5e5",
    },
    fonts: {
      heading: brandMemory.fontHeading ?? "Sans-serif",
      body: brandMemory.fontBody ?? "Sans-serif",
    },
    radius: "0.5rem",
  });

  const logo: BrandLogo = { type: "text", value: businessInput.businessName };
  const headingStyle: HeadingStyle = { uppercase: false, bold: true };
  const homePagePrimaryCta = { label: "Get started", href: "#cta" };

  const designSystem: DesignSystemV2 = {
    version: "2",
    siteMetadata: {
      framework: "astro",
      mode: "greenfield",
      businessName: businessInput.businessName,
      generatedAt: now,
    },
    global: {
      tokens: greenfieldTokens,
      shell: {
        header: undefined,
        footer: undefined,
        navLinks: [],
      },
      rules: {
        spacing: "Default section vertical padding; hero uses larger vertical spacing.",
        radius: greenfieldTokens.radius,
        maxWidth: "max-w-6xl with responsive gutters.",
        grid: "2–3 column grids for feature lists; single column on mobile.",
        defaultTheme: "light",
      },
    },
    business: {
      name: businessInput.businessName,
      tagline: businessInput.tagline,
    },
    brand: { logo, headingStyle },
    reference: { screenshotUrl: null, homePagePrimaryCta },
  };

  const heroSection: HierarchySection = {
    id: "hero-greenfield",
    tag: "hero",
    intent: sectionTagIntent("hero"),
    content: {
      heading: businessInput.businessName,
      body: businessInput.tagline ?? businessInput.description ?? "",
      cta: homePagePrimaryCta,
    },
    evidenceId: "greenfield-index-hero-greenfield",
  };

  const hierarchy: SiteHierarchy = {
    version: "1",
    siteMetadata: {
      framework: "astro",
      mode: "greenfield",
      businessName: businessInput.businessName,
      generatedAt: now,
    },
    pages: [
      {
        slug: "index",
        isHomePage: true,
        title: businessInput.businessName,
        metaTitle: businessInput.tagline
          ? `${businessInput.businessName} — ${businessInput.tagline}`
          : businessInput.businessName,
        metaDescription: businessInput.description,
        primaryCta: heroSection.content.cta,
        sections: [heroSection],
      },
    ],
    buildPlan: {
      nextPage: "index",
      pageStatus: { index: "in_progress" },
      buildOrder: ["index"],
    },
  };

  const evidence = buildEmptySectionVisualEvidence();

  const docs: GeneratedSiteDoc[] = [
    { key: SITE_MEMORY_DOC_KEY, title: SITE_MEMORY_DOC_TITLE, content: siteMemory, source: "ai_extracted" },
    { key: SITE_STRATEGY_DOC_KEY, title: SITE_STRATEGY_DOC_TITLE, content: siteStrategy, source: "ai_extracted" },
    { key: BUSINESS_INFO_DOC_KEY, title: BUSINESS_INFO_DOC_TITLE, content: businessInfo, source: "ai_extracted" },
    {
      key: DESIGN_SYSTEM_DOC_KEY,
      title: DESIGN_SYSTEM_DOC_TITLE,
      content: makeJsonDocContent("Design system", "This doc holds the locked global design system used to build every page.", designSystem),
      source: "ai_extracted",
    },
    {
      key: SITE_HIERARCHY_DOC_KEY,
      title: SITE_HIERARCHY_DOC_TITLE,
      content: makeJsonDocContent("Site hierarchy", "This doc holds the semantic page/section hierarchy.", hierarchy),
      source: "ai_extracted",
    },
    {
      key: SECTION_VISUAL_EVIDENCE_DOC_KEY,
      title: SECTION_VISUAL_EVIDENCE_DOC_TITLE,
      content: `# Section visual evidence\n\nThis doc holds per-section screenshots, computed styles, and DOM snippets used by the generic visual block renderer. Greenfield mode has no captured evidence yet.\n\n## Section visual evidence\n\n\`\`\`json\n${JSON.stringify(evidence, null, 2)}\n\`\`\`\n`,
      source: "ai_extracted",
    },
  ];

  validateGeneratedDocs(docs);
  return docs;
}

export async function generateSiteDocs(
  data: ScrapedWebsiteData,
  gmb?: GmbListing,
  config?: Config,
  memoryCtx?: WorkspaceMemoryContext,
  screenshotUrl?: string | null,
  mode: SiteHierarchy["siteMetadata"]["mode"] = "replication",
): Promise<GeneratedSiteDoc[]> {
  const ctx: DocGenerationContext = { scraped: data, gmb };
  const brandInput = buildBrandGuidelinesInput(ctx);
  const workspaceMemory = await generateWorkspaceMemory(data, gmb, config, memoryCtx);
  const siteMemory = generateSiteMemory(data);

  let extracted: BusinessInfoExtractionResult | null = null;
  if (config && memoryCtx) {
    extracted = await extractBusinessInfoFields(data, gmb, config, {
      db: memoryCtx.db,
      workspaceUuid: memoryCtx.workspaceUuid,
      userUuid: memoryCtx.userUuid,
      siteUuid: memoryCtx.siteUuid,
    });
  }

  const businessInfoCtx: BusinessInfoDocContext = { ...ctx, extracted };

  const docs: GeneratedSiteDoc[] = [
    {
      key: WORKSPACE_MEMORY_DOC_KEY,
      title: WORKSPACE_MEMORY_DOC_TITLE,
      content: renderWorkspaceMemory(workspaceMemory),
      source: "ai_extracted",
    },
    {
      key: SITE_MEMORY_DOC_KEY,
      title: SITE_MEMORY_DOC_TITLE,
      content: renderSiteMemory(siteMemory),
      source: "ai_extracted",
    },
    {
      key: BRAND_GUIDELINES_DOC_KEY,
      title: BRAND_GUIDELINES_DOC_TITLE,
      content: generateBrandGuidelines(brandInput),
      source: "ai_extracted",
    },
    await makeBusinessInfoDoc(businessInfoCtx, config, memoryCtx),
    makeSiteStrategyDoc(ctx),
    makeBlueprintDraftDoc(ctx),
    makeDesignSystemDoc(ctx, screenshotUrl, mode),
    makeSiteHierarchyDoc(ctx, mode),
    makeSectionVisualEvidenceDoc(ctx),
  ];

  validateGeneratedDocs(docs);
  return docs;
}

/**
 * Docs that are workspace-scoped rather than tied to a single site.
 */
const WORKSPACE_DOC_KEYS = new Set([
  "workspace-memory",
  "brand-guidelines",
]);

function docSiteUuid(doc: GeneratedSiteDoc, siteUuid?: string): string | null {
  return WORKSPACE_DOC_KEYS.has(doc.key) ? null : (siteUuid ?? null);
}

export async function saveSiteDocs(
  db: Kysely<DB>,
  workspaceUuid: string,
  docs: GeneratedSiteDoc[],
  siteUuid?: string,
): Promise<void> {
  validateGeneratedDocs(docs);

  for (const doc of docs) {
    const docSite = docSiteUuid(doc, siteUuid);
    const existing = await db
      .selectFrom("docs")
      .select("uuid")
      .where("workspaceUuid", "=", workspaceUuid)
      .where("key", "=", doc.key)
      .where("siteUuid", docSite ? "=" : "is", docSite)
      .executeTakeFirst();

    if (existing) {
      await db
        .updateTable("docs")
        .set({
          title: doc.title,
          content: doc.content,
          source: doc.source,
          status: "active",
          updatedAt: new Date(),
          siteUuid: docSite,
        })
        .where("uuid", "=", existing.uuid)
        .execute();
    } else {
      await db
        .insertInto("docs")
        .values({
          workspaceUuid,
          key: doc.key,
          title: doc.title,
          content: doc.content,
          source: doc.source,
          status: "active",
          siteUuid: docSite,
        })
        .execute();
    }
  }
}
