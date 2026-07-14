// apps/api/src/services/eval/checks/fidelity.ts
// Deterministic fidelity checks: rendered page vs GymSiteContent and vs site-hierarchy.

import * as cheerio from "cheerio";
import type { GymSiteContent } from "@milo/shared-types";
import { NO_IMAGE } from "@milo/shared-types";
import { loadSiteHierarchyDoc } from "../../../utils/site-hierarchy-io.js";
import type { SiteHierarchy, HierarchyPage, CanonicalSectionTag } from "../../../types/site-hierarchy.js";
import { getTemplateSpec, pageKeyByPath, pageComponents } from "@milo/shared-types";
import type { CheckContext } from "./check-context.js";
import type { PageEvalIssue } from "../page-eval-report.js";

// ---------------------------------------------------------------------------
// Template fidelity: rendered page should accurately represent GymSiteContent.
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function containsText(html: string, value: string | undefined): boolean {
  if (!value) return false;
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const bodyText = normalizeText($("body").text());
  return bodyText.includes(normalizeText(value));
}

function containsLink(
  html: string,
  label: string | undefined,
  href: string | undefined,
): { found: boolean; labelMatch: boolean; hrefMatch: boolean } {
  if (!label && !href) return { found: false, labelMatch: false, hrefMatch: false };
  const $ = cheerio.load(html);
  let labelMatch = false;
  let hrefMatch = false;
  $("a").each((_, el) => {
    const aLabel = normalizeText($(el).text());
    const aHref = ($(el).attr("href") ?? "").trim();
    if (label && aLabel.includes(normalizeText(label))) labelMatch = true;
    if (href) {
      // Compare path only, ignoring trailing slash and query/fragment.
      const normalizedHref = (aHref.split(/[?#]/)[0] ?? "").replace(/\/$/, "").toLowerCase();
      const normalizedTarget = (href.split(/[?#]/)[0] ?? "").replace(/\/$/, "").toLowerCase();
      if (normalizedHref === normalizedTarget) {
        hrefMatch = true;
      }
    }
  });
  return { found: labelMatch && hrefMatch, labelMatch, hrefMatch };
}

function pageContentByPath(content: GymSiteContent, path: string): { pageKey?: string; hero?: { headline?: string } } {
  if (path === "/" || path === "") return { pageKey: "home", hero: content.pages.home.hero };
  if (path.startsWith("/programs/")) {
    const slug = path.replace("/programs/", "").replace(/\/$/, "");
    const program = content.pages.programs.find((p) => p.slug === slug);
    if (program) return { pageKey: "program", hero: program.hero };
  }
  const topLevel = path.replace(/^\//, "").replace(/\/$/, "");
  if (topLevel === "about") return { pageKey: "about", hero: content.pages.about.hero };
  if (topLevel === "contact") return { pageKey: "contact", hero: content.pages.contact.hero };
  if (topLevel === "pricing") return { pageKey: "pricing", hero: content.pages.pricing.hero };
  if (topLevel === "schedule") return { pageKey: "schedule", hero: content.pages.schedule.hero };
  if (topLevel === "local-guide") return { pageKey: "localGuide", hero: content.pages.localGuide?.hero };
  return {};
}

/**
 * Resolve a pageField source path against GymSiteContent. Supports simple paths
 * like "hero" (relative to the current page) and absolute paths like
 * "pages.home.iframes". Returns undefined when the field is missing or empty.
 */
function resolvePageField(
  content: GymSiteContent | undefined,
  pageKey: string,
  path: string,
): unknown {
  if (!content) return undefined;
  if (path.startsWith("pages.")) {
    const parts = path.split(".");
    let value: unknown = content;
    for (const part of parts) {
      if (value == null) return undefined;
      value = (value as Record<string, unknown>)[part];
    }
    return value;
  }
  // Relative path on the current page object, e.g. "iframes" or "hero".
  const page = (content.pages as unknown as Record<string, unknown>)[pageKey];
  if (!page) return undefined;
  return (page as Record<string, unknown>)[path];
}

export async function checkTemplateFidelity(ctx: CheckContext): Promise<PageEvalIssue[]> {
  const issues: PageEvalIssue[] = [];
  if (!ctx.content) {
    issues.push({
      severity: "info",
      category: "content",
      message: "No gym.json content available — template fidelity checks skipped",
    });
    return issues;
  }

  const html = await ctx.page.content();
  const text = normalizeText(
    cheerio
      .load(html)("body")
      .text()
      .replace(/\s+/g, " ")
      .trim(),
  );
  const business = ctx.content.business;

  // Business name should be visible.
  if (business.name && !containsText(html, business.name)) {
    issues.push({
      severity: "major",
      category: "content",
      message: `Business name "${business.name}" is not visible on the page`,
      fix: "Add the gym name to the title, hero, or footer so visitors know whose site this is.",
    });
  }

  // Location context should be visible on most pages.
  if (business.geo?.city && !text.includes(business.geo.city.toLowerCase())) {
    const isLocationPage = ctx.path === "/contact" || ctx.path === "/local-guide" || ctx.path === "/";
    issues.push({
      severity: isLocationPage ? "major" : "minor",
      category: "content",
      message: `City "${business.geo.city}" is not mentioned on the page`,
      fix: "Reference the gym's city in the hero, location section, or page copy for local SEO.",
    });
  }

  // Phone should be reachable.
  if (business.phone) {
    const phoneDigits = business.phone.replace(/\D/g, "");
    const hasPhone = text.includes(business.phone.toLowerCase()) || html.includes(`tel:${phoneDigits}`);
    if (!hasPhone) {
      issues.push({
        severity: "major",
        category: "content",
        message: `Phone number "${business.phone}" is not visible or callable`,
        fix: "Add the gym phone number as a clickable tel: link in the header, footer, or contact section.",
      });
    }
  }

  // Primary CTA must be present and clickable.
  if (business.primaryCta?.label) {
    const cta = containsLink(html, business.primaryCta.label, business.primaryCta.url);
    if (!cta.found) {
      const detail = !cta.labelMatch
        ? "the label was not found"
        : "the href did not match the configured URL";
      issues.push({
        severity: "major",
        category: "content",
        message: `Primary CTA "${business.primaryCta.label}" is not rendered as a working link (${detail})`,
        fix: `Add a prominent link/button labeled "${business.primaryCta.label}" pointing to "${business.primaryCta.url}".`,
      });
    }
  }

  // Navigation header links should be represented.
  const nav = ctx.content.navigation;
  if (nav?.header?.length) {
    for (const item of nav.header) {
      if (!item.label) continue;
      const link = containsLink(html, item.label, item.href);
      if (!link.labelMatch) {
        issues.push({
          severity: "major",
          category: "content",
          message: `Navigation item "${item.label}" is missing from the rendered page`,
          fix: "Add the missing navigation link to the header.",
        });
      }
    }
  }

  // Hero headline for the current page should be present.
  const { hero } = pageContentByPath(ctx.content, ctx.path);
  if (hero?.headline && !containsText(html, hero.headline)) {
    issues.push({
      severity: "major",
      category: "content",
      message: `Page hero headline "${hero.headline}" is not rendered`,
      fix: "Render the configured hero headline in the page's H1 or hero section.",
    });
  }

  // Home page specific checks.
  if (ctx.path === "/" || ctx.path === "") {
    const home = ctx.content.pages.home;

    for (const slug of home.featuredPrograms ?? []) {
      const program = ctx.content.pages.programs.find((p) => p.slug === slug);
      if (program?.name && !containsText(html, program.name)) {
        issues.push({
          severity: "major",
          category: "content",
          message: `Featured program "${program.name}" (${slug}) is not represented on the home page`,
          fix: "Include the program name in the programs grid or link to its page.",
        });
      }
    }

    if (home.testimonials?.length && !home.testimonials.some((t) => containsText(html, t.quote))) {
      issues.push({
        severity: "major",
        category: "content",
        message: "Testimonials are configured but none of the configured quotes appear on the page",
        fix: "Render at least one configured testimonial quote in the testimonials section.",
      });
    }

    if (home.faq?.length && !home.faq.some((f) => containsText(html, f.question))) {
      issues.push({
        severity: "major",
        category: "content",
        message: "FAQ items are configured but none of the configured questions appear on the page",
        fix: "Render the configured FAQ questions and answers in the FAQ section.",
      });
    }
  }

  // Address should appear on contact or home pages.
  const address = business.address;
  if (address?.street && (ctx.path === "/" || ctx.path === "" || ctx.path === "/contact")) {
    if (!containsText(html, address.street)) {
      issues.push({
        severity: ctx.path === "/contact" ? "major" : "minor",
        category: "content",
        message: `Street address "${address.street}" is not visible`,
        fix: "Display the gym's full street address in the location or contact section.",
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Registry structure fidelity: for managed/template sites, compare the page
// against the TemplateSpec component sequence.
// ---------------------------------------------------------------------------

function renderedSectionIds(html: string): string[] {
  const $ = cheerio.load(html);
  return $("[data-section]")
    .map((_, el) => $(el).attr("data-section")?.trim())
    .get()
    .filter(Boolean);
}

function isMissingOrPlaceholder(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string" && (value === "" || value === NO_IMAGE || value.includes("__PLACEHOLDER__"))) {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function checkRegistryStructureFidelity(
  html: string,
  templateTheme: string,
  path: string,
  content: GymSiteContent | undefined,
): PageEvalIssue[] {
  const issues: PageEvalIssue[] = [];
  const spec = getTemplateSpec(templateTheme as "baseline" | "impact" | "beanburito");
  if (!spec) {
    issues.push({
      severity: "info",
      category: "content",
      message: `No template spec registered for theme "${templateTheme}" — registry structure checks skipped`,
    });
    return issues;
  }

  const pageKey = pageKeyByPath(spec, path);
  if (!pageKey) {
    issues.push({
      severity: "info",
      category: "content",
      message: `Path "${path}" does not match any page in the ${spec.name} template spec — registry structure checks skipped`,
    });
    return issues;
  }

  const pageSpec = spec.pages[pageKey];
  const expectedIds = pageComponents(spec, pageKey);
  const actualIds = renderedSectionIds(html);

  // Check each expected component is present. Conditional components may be skipped
  // when their required data is missing, so we consult the spec before flagging.
  for (const componentId of expectedIds) {
    if (!actualIds.includes(componentId)) {
      const componentSpec = spec.components[componentId];
      if (componentSpec?.conditional) {
        const firstPropKey = Object.keys(componentSpec.props)[0];
        const source = firstPropKey ? componentSpec.props[firstPropKey]?.source : undefined;
        const fieldPath = source?.kind === "pageField" ? source.path : undefined;
        const hasData = fieldPath
          ? Boolean(resolvePageField(content, pageKey, fieldPath))
          : true;
        if (!hasData) continue;
      }
      issues.push({
        severity: componentId === "hero" ? "critical" : "major",
        category: "content",
        message: `Expected section "${componentId}" from the ${spec.name} template is missing`,
        fix: `Add the "${componentId}" section to the rendered page or update the template spec.`,
        sectionId: componentId,
      });
    }
  }

  // Check required fields declared by the page spec. Missing or placeholder
  // values are publish blockers for pages with placeholderPolicy "block-publish".
  if (pageSpec?.requiredFields?.length) {
    for (const fieldPath of pageSpec.requiredFields) {
      const value = resolvePageField(content, pageKey, fieldPath);
      if (isMissingOrPlaceholder(value)) {
        issues.push({
          severity: "critical",
          category: "content",
          message: `Required field ${fieldPath} is missing or uses a placeholder`,
          fix: `Provide real content for ${fieldPath}.`,
          sectionId: fieldPath,
        });
      }
    }
  }

  // Order check: each expected component must appear at an index that is
  // not earlier than the previously found component.
  if (expectedIds.length > 1 && actualIds.length > 0) {
    let lastFoundIndex = -1;
    let orderMismatch = false;
    for (const expected of expectedIds) {
      const idx = actualIds.indexOf(expected);
      if (idx === -1) continue;
      if (idx < lastFoundIndex) orderMismatch = true;
      lastFoundIndex = idx;
    }
    if (orderMismatch) {
      issues.push({
        severity: "major",
        category: "content",
        message: `Page sections are not in the order declared by the ${spec.name} template spec`,
        fix: "Reorder rendered sections to match the template spec.",
      });
    }
  }

  // Detect unexpected sections.
  const allowedIds = new Set([...expectedIds, "header", "footer"]);
  const unexpected = actualIds.filter((id) => !allowedIds.has(id));
  if (unexpected.length) {
    issues.push({
      severity: "minor",
      category: "content",
      message: `Rendered page contains sections not declared in the ${spec.name} template spec: ${[...new Set(unexpected)].join(", ")}`,
      fix: "Either add these sections to the template spec or remove them from the rendered page.",
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Structure fidelity: rendered page should contain the sections declared by
// site-hierarchy (and, for managed/template sites, the template registry).
// ---------------------------------------------------------------------------

const TAG_SELECTOR_HINTS: Record<CanonicalSectionTag, string[]> = {
  hero: ["[data-section='hero']", "h1"],
  header: ["header", "nav"],
  footer: ["footer"],
  "cta-band": ["[data-section='ctaBand']", "a[data-track='contact']"],
  "content-block": ["[data-section], article, .prose"],
  "media-block": ["[data-section], img, video"],
  "feature-grid": ["[data-section='amenities']", ".grid"],
  "testimonial-band": ["[data-section='testimonials']", "blockquote"],
  "location-block": ["[data-section='location']", "address, iframe[src*='maps']"],
  "faq-block": ["[data-section='faq']", "details, .faq-item"],
  "social-proof-band": ["[data-section='testimonials']", "blockquote"],
  "steps-band": ["[data-section='howItWorks']", "ol"],
  schedule: ["[data-section], [data-widget='schedule']"],
  team: ["[data-section], .team-member"],
  contact: ["[data-section='location']", "form, address"],
  iframe: ["[data-section='iframe']", "iframe[src]"],
  unknown: [],
};

function findHierarchyPage(hierarchy: SiteHierarchy, path: string): HierarchyPage | undefined {
  return hierarchy.pages.find((p) => {
    if (path === "/" || path === "") return p.isHomePage || p.path === "/" || p.slug === "index" || p.slug === "";
    return p.path === path || `/${p.slug}` === path;
  });
}

function renderedSectionTags(html: string): string[] {
  const $ = cheerio.load(html);
  return $("[data-section-tag]")
    .map((_, el) => $(el).attr("data-section-tag")?.trim())
    .get()
    .filter(Boolean);
}

function hasSection(html: string, tag: CanonicalSectionTag, heading?: string): boolean {
  if (tag === "unknown" || tag === "header" || tag === "footer") return true;
  const $ = cheerio.load(html);
  const hints = TAG_SELECTOR_HINTS[tag];
  if (heading) {
    const normalizedHeading = normalizeText(heading);
    for (const selector of hints) {
      const found = $(selector)
        .toArray()
        .some((el) => normalizeText($(el).text()).includes(normalizedHeading));
      if (found) return true;
    }
  }
  for (const selector of hints) {
    if ($(selector).length > 0) return true;
  }
  return false;
}

export async function checkStructureFidelity(ctx: CheckContext): Promise<PageEvalIssue[]> {
  const issues: PageEvalIssue[] = [];
  const html = await ctx.page.content();

  // Managed/template sites use the TemplateSpec as the source of truth.
  const templateTheme = ctx.content?.meta?.templateTheme;
  if (ctx.siteMode === "template" || ctx.siteMode === "greenfield") {
    if (templateTheme) {
      const registryIssues = checkRegistryStructureFidelity(html, templateTheme, ctx.path, ctx.content);
      issues.push(...registryIssues);
    } else {
      issues.push({
        severity: "info",
        category: "content",
        message: "Site is in template mode but gym.json does not declare a templateTheme — registry structure checks skipped",
      });
    }
    return issues;
  }

  // Replication/Tier 1 sites use the site-hierarchy doc.
  const hierarchy = await loadSiteHierarchyDoc(ctx.db, ctx.workspaceUuid, ctx.siteUuid);
  const hierarchyPage = hierarchy ? findHierarchyPage(hierarchy, ctx.path) : undefined;

  if (!hierarchyPage && !hierarchy) {
    issues.push({
      severity: "info",
      category: "content",
      message: "No site-hierarchy doc found — structure fidelity checks skipped",
    });
  }

  if (hierarchyPage) {
    const expectedTags = hierarchyPage.sections.map((s) => s.tag);
    const actualTags = renderedSectionTags(html);

    // Check each declared section is present.
    for (const section of hierarchyPage.sections) {
      if (!hasSection(html, section.tag, section.content?.heading)) {
        issues.push({
          severity: section.tag === "hero" ? "critical" : "major",
          category: "content",
          message: `Declared section "${section.tag}"${section.content?.heading ? ` (${section.content.heading})` : ""} is missing from the rendered page`,
          fix: `Add or restore a "${section.tag}" section matching the site-hierarchy declaration.`,
          sectionId: section.id,
        });
      }
    }

    // Order check using sourceOrder when available, otherwise array order.
    const orderedExpected = hierarchyPage.sections
      .filter((s) => s.tag !== "header" && s.tag !== "footer" && s.tag !== "unknown")
      .sort((a, b) => (a.styleHint?.sourceOrder ?? 0) - (b.styleHint?.sourceOrder ?? 0))
      .map((s) => s.tag);

    if (orderedExpected.length > 1 && actualTags.length > 0) {
      let lastFoundIndex = -1;
      let orderMismatch = false;
      for (const expected of orderedExpected) {
        const idx = actualTags.indexOf(expected);
        if (idx === -1) {
          // Missing section already reported above.
          continue;
        }
        if (idx < lastFoundIndex) {
          orderMismatch = true;
        }
        lastFoundIndex = idx;
      }
      if (orderMismatch) {
        issues.push({
          severity: "major",
          category: "content",
          message: "Page sections are not in the order declared by site-hierarchy",
          fix: "Reorder rendered sections to match the site-hierarchy declaration.",
        });
      }
    }

    // Detect unexpected sections that are not in the declaration.
    const allowedTags = new Set([...expectedTags, "header", "footer", "unknown"]);
    const unexpected = actualTags.filter((t) => !allowedTags.has(t as CanonicalSectionTag));
    if (unexpected.length) {
      issues.push({
        severity: "minor",
        category: "content",
        message: `Rendered page contains sections not declared in site-hierarchy: ${[...new Set(unexpected)].join(", ")}`,
        fix: "Either add these sections to the site-hierarchy declaration or remove them from the rendered page.",
      });
    }
  }

  return issues;
}
