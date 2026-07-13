// apps/api/src/services/eval/eval-fix.ts
// Turn a per-page QA report into deterministic content heals + a fix brief that
// the build process can consume to re-render the page.

import type { GymSiteContent, HeroContent, NavItem } from "@ploy-gyms/shared-types";
import { sanitizeContentCtas } from "../template/content-mapper.js";
import type { SiteHierarchy, HierarchyPage } from "../../types/site-hierarchy";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type { PageEvalReport, PageEvalIssue, PageEvalCategoryName, PageEvalActionItem } from "./page-eval-report.js";

export interface AppliedHeal {
  category: PageEvalCategoryName;
  severity: PageEvalIssue["severity"];
  target: string;
  message: string;
  before?: string;
  after?: string;
}

export interface SectionFixInstruction {
  sectionId: string;
  instructions: string;
}

export interface FixBrief {
  /** Deterministic edits that were already applied to the content/hierarchy/design-system docs. */
  appliedHeals: AppliedHeal[];
  /** Per-section visual/interactivity instructions passed to the visual renderer. */
  sectionInstructions: SectionFixInstruction[];
  /** Global instructions appended to every visual block prompt on the rebuild. */
  globalInstructions?: string;
}

export interface EvalFixInput {
  report: PageEvalReport;
  /** gym.json content, when this is a template/Tier 2 site. May be undefined for Tier 1 clones. */
  content: GymSiteContent | undefined;
  hierarchy: SiteHierarchy;
  designSystem: DesignSystemV2;
  pageSlug: string;
}

export interface EvalFixOutput {
  content: GymSiteContent | undefined;
  hierarchy: SiteHierarchy;
  designSystem: DesignSystemV2;
  brief: FixBrief;
  changed: boolean;
}

const BASE_TEMPLATE_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/pricing",
  "/schedule",
  "/blog",
  "/local-guide",
  "/programs",
]);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pageTitle(hierarchyPage: HierarchyPage | undefined, content: GymSiteContent | undefined): string {
  return hierarchyPage?.title ?? content?.business?.name ?? "Your gym";
}

function buildDefaultMetaTitle(hierarchyPage: HierarchyPage | undefined, content: GymSiteContent | undefined): string {
  const title = pageTitle(hierarchyPage, content);
  const business = content?.business?.name;
  return business && !title.includes(business) ? `${title} | ${business}` : title;
}

function buildDefaultMetaDescription(hierarchyPage: HierarchyPage | undefined, content: GymSiteContent | undefined): string {
  return (
    content?.business?.tagline ??
    `${content?.business?.name ?? "Our gym"} offers personal training, group classes, and a supportive community.`
  );
}

function isExternalOrSpecial(href: string): boolean {
  return /^(https?:|mailto:|tel:|#)/i.test(href);
}

function buildAllowedPaths(content: GymSiteContent | undefined, hierarchy: SiteHierarchy): Set<string> {
  const paths = new Set(BASE_TEMPLATE_PATHS);
  for (const page of hierarchy.pages) {
    const slug = page.slug === "index" ? "" : page.slug;
    paths.add(`/${slug}`.replace(/\/+/g, "/") || "/");
  }
  if (content) {
    for (const program of content.pages.programs) {
      paths.add(`/programs/${program.slug}`);
    }
    for (const legal of content.pages.legal) {
      paths.add(`/legal/${legal.slug}`);
    }
  }
  return paths;
}

function sanitizeHref(
  href: string | undefined | null,
  allowedPaths: Set<string>,
  fallback: string,
): string {
  if (!href) return fallback;
  if (isExternalOrSpecial(href)) return href;
  const normalized = href.toLowerCase().replace(/\/+$/, "") || "/";
  return allowedPaths.has(normalized) ? href : fallback;
}

function sanitizeNavItems(
  items: NavItem[] | undefined,
  allowedPaths: Set<string>,
  fallback: string,
  applied: AppliedHeal[],
  context: string,
): NavItem[] | undefined {
  if (!items) return undefined;
  return items.map((item) => {
    const fixed = sanitizeHref(item.href, allowedPaths, fallback);
    if (fixed !== item.href) {
      applied.push({
        category: "links",
        severity: "major",
        target: `${context}.${item.label}`,
        message: `Navigation link "${item.label}" pointed to missing page`,
        before: item.href,
        after: fixed,
      });
    }
    return { ...item, href: fixed };
  });
}

function ensurePrimaryCta(content: GymSiteContent, allowedPaths: Set<string>, applied: AppliedHeal[]): void {
  const business = content.business;
  const fallbackUrl = "/contact";
  if (!business.primaryCta) {
    business.primaryCta = { label: "Get started", url: fallbackUrl };
    applied.push({ category: "content", severity: "critical", target: "business.primaryCta", message: "Missing primary CTA — added default", after: business.primaryCta.label });
  } else {
    if (!business.primaryCta.label) {
      const before = business.primaryCta.label;
      business.primaryCta.label = "Get started";
      applied.push({ category: "content", severity: "major", target: "business.primaryCta.label", message: "Primary CTA missing label", before, after: business.primaryCta.label });
    }
    const fixedUrl = sanitizeHref(business.primaryCta.url, allowedPaths, fallbackUrl);
    if (fixedUrl !== business.primaryCta.url) {
      applied.push({
        category: "links",
        severity: "major",
        target: "business.primaryCta.url",
        message: "Primary CTA URL pointed to missing page",
        before: business.primaryCta.url,
        after: fixedUrl,
      });
      business.primaryCta.url = fixedUrl;
    }
  }
}

function ensureHeroCta(hero: HeroContent | undefined, allowedPaths: Set<string>, primaryUrl: string, applied: AppliedHeal[], context: string): void {
  if (!hero) return;
  const fallback = primaryUrl || "/contact";
  const fixedUrl = sanitizeHref(hero.ctaUrl, allowedPaths, fallback);
  if (fixedUrl !== hero.ctaUrl) {
    applied.push({
      category: "links",
      severity: "major",
      target: `${context}.hero.ctaUrl`,
      message: "Hero CTA URL was missing or pointed to an unresolvable page",
      before: hero.ctaUrl,
      after: fixedUrl,
    });
    hero.ctaUrl = fixedUrl;
  }
  if (!hero.ctaLabel) {
    hero.ctaLabel = "Get started";
    applied.push({ category: "content", severity: "minor", target: `${context}.hero.ctaLabel`, message: "Hero CTA missing label — added default", after: hero.ctaLabel });
  }
}

function findSectionId(issue: PageEvalIssue | PageEvalActionItem, sectionIds: Set<string>): string | undefined {
  if ("sectionId" in issue && issue.sectionId && sectionIds.has(issue.sectionId)) {
    return issue.sectionId;
  }
  const haystack = ` ${issue.message} ${issue.selector ?? ""} ${issue.fix ?? ""} `;
  for (const id of sectionIds) {
    // Match whole token/ID only, not substrings like s1 inside s10.
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`).test(haystack)) return id;
  }
  return undefined;
}

function issueSeverity(issue: PageEvalIssue | PageEvalActionItem): PageEvalIssue["severity"] {
  return "severity" in issue ? issue.severity : issue.priority;
}

function issueToInstruction(issue: PageEvalIssue | PageEvalActionItem): string {
  let instruction = issue.fix ?? "";
  if (!instruction) {
    switch (issue.category) {
      case "accessibility":
        instruction = "Verify all interactive elements are keyboard accessible and include correct ARIA labels.";
        break;
      case "seo":
        instruction = "Ensure semantic HTML, unique title/meta, and exactly one H1 per page.";
        break;
      case "links":
        instruction = "Fix or remove broken/internal links that point to pages that do not exist.";
        break;
      case "interactivity":
        instruction = "Implement interactive components with Alpine.js and verify mobile menu/buttons work.";
        break;
      case "performance":
        instruction = "Optimize images, lazy-load below-the-fold assets, and eliminate render-blocking resources.";
        break;
      case "content":
        instruction = "Replace generic or placeholder copy with specific, business-focused content.";
        break;
      case "visual":
        instruction = "Use real, high-quality images with descriptive alt text and ensure visual hierarchy matches the design system.";
        break;
      default:
        instruction = issue.message;
    }
  }
  return `- [${issueSeverity(issue).toUpperCase()}] ${issue.message} → ${instruction}`;
}

function collectAllIssues(report: PageEvalReport): (PageEvalIssue | PageEvalActionItem)[] {
  const actionItems = report.overall.actionItems.map((a) => ({ ...a, category: a.category }));
  const categoryIssues = report.categories.flatMap((c) =>
    c.issues.map((i) => ({ ...i, category: i.category })),
  );
  return [...actionItems, ...categoryIssues];
}

/**
 * Apply deterministic content/design-system heals and build a fix brief for the
 * visual renderer. The returned objects are deep-cloned so the caller can diff
 * or save them safely.
 */
export function buildFixPlan(input: EvalFixInput): EvalFixOutput {
  const { report, content, hierarchy, designSystem, pageSlug } = input;

  const nextContent = content ? clone(content) : undefined;
  const nextHierarchy = clone(hierarchy);
  const nextDesignSystem = clone(designSystem);
  const applied: AppliedHeal[] = [];

  const hierarchyPage = nextHierarchy.pages.find((p) => p.slug === pageSlug);
  const sectionIds = new Set((hierarchyPage?.sections ?? []).map((s) => s.id));
  const allowedPaths = buildAllowedPaths(nextContent, nextHierarchy);

  // 1. SEO: ensure title/meta exist for the page.
  if (hierarchyPage) {
    if (!hierarchyPage.metaTitle) {
      const title = buildDefaultMetaTitle(hierarchyPage, nextContent);
      applied.push({ category: "seo", severity: "major", target: `hierarchy.pages.${pageSlug}.metaTitle`, message: "Missing page meta title", after: title });
      hierarchyPage.metaTitle = title;
    }
    if (!hierarchyPage.metaDescription) {
      const desc = buildDefaultMetaDescription(hierarchyPage, nextContent);
      applied.push({ category: "seo", severity: "major", target: `hierarchy.pages.${pageSlug}.metaDescription`, message: "Missing page meta description", after: desc });
      hierarchyPage.metaDescription = desc;
    }
  }

  // 2. Template content heals.
  if (nextContent) {
    // Default site meta.
    if (!nextContent.meta.defaultTitle) {
      nextContent.meta.defaultTitle = buildDefaultMetaTitle(hierarchyPage, nextContent);
      applied.push({ category: "seo", severity: "minor", target: "content.meta.defaultTitle", message: "Missing default site title", after: nextContent.meta.defaultTitle });
    }
    if (!nextContent.meta.defaultDescription) {
      nextContent.meta.defaultDescription = buildDefaultMetaDescription(hierarchyPage, nextContent);
      applied.push({ category: "seo", severity: "minor", target: "content.meta.defaultDescription", message: "Missing default site description", after: nextContent.meta.defaultDescription });
    }

    ensurePrimaryCta(nextContent, allowedPaths, applied);
    const primaryUrl = nextContent.business.primaryCta.url;

    // Hero CTAs across all known pages.
    ensureHeroCta(nextContent.pages.home.hero, allowedPaths, primaryUrl, applied, "pages.home");
    for (const program of nextContent.pages.programs) {
      ensureHeroCta(program.hero, allowedPaths, primaryUrl, applied, `pages.programs.${program.slug}`);
    }
    ensureHeroCta(nextContent.pages.about.hero, allowedPaths, primaryUrl, applied, "pages.about");
    ensureHeroCta(nextContent.pages.pricing.hero, allowedPaths, primaryUrl, applied, "pages.pricing");
    ensureHeroCta(nextContent.pages.contact.hero, allowedPaths, primaryUrl, applied, "pages.contact");
    ensureHeroCta(nextContent.pages.schedule.hero, allowedPaths, primaryUrl, applied, "pages.schedule");
    if (nextContent.pages.localGuide?.hero) {
      ensureHeroCta(nextContent.pages.localGuide.hero, allowedPaths, primaryUrl, applied, "pages.localGuide");
    }

    // Run the existing mapper sanitizer on CTAs to catch any remaining bad URLs.
    const mapperWarnings: string[] = [];
    sanitizeContentCtas(nextContent.pages, nextContent.business, mapperWarnings);
    for (const warning of mapperWarnings) {
      applied.push({ category: "links", severity: "major", target: "content-mapper", message: warning });
    }

    // Navigation/footer links.
    if (nextContent.navigation.header.length > 0) {
      nextContent.navigation.header = sanitizeNavItems(nextContent.navigation.header, allowedPaths, primaryUrl, applied, "navigation.header") ?? [];
    }
    for (const group of nextContent.navigation.footer) {
      group.links = sanitizeNavItems(group.links, allowedPaths, primaryUrl, applied, `navigation.footer.${group.label}`) ?? [];
    }
  }

  // 3. Design-system nav links.
  if (nextDesignSystem.global.shell.navLinks) {
    const primaryUrl = nextContent?.business.primaryCta.url ?? "/contact";
    nextDesignSystem.global.shell.navLinks = sanitizeNavItems(
      nextDesignSystem.global.shell.navLinks,
      allowedPaths,
      primaryUrl,
      applied,
      "designSystem.global.shell.navLinks",
    ) ?? [];
  }

  // 4. Build instruction brief for issues we cannot fix deterministically.
  const allIssues = collectAllIssues(report);
  const sectionMap = new Map<string, string[]>();
  const globals: string[] = [];

  for (const issue of allIssues) {
    const sectionId = findSectionId(issue, sectionIds);
    const instruction = issueToInstruction(issue);
    if (sectionId) {
      const list = sectionMap.get(sectionId) ?? [];
      list.push(instruction);
      sectionMap.set(sectionId, list);
    } else {
      globals.push(instruction);
    }
  }

  const sectionInstructions: SectionFixInstruction[] = [];
  for (const [sectionId, instructions] of sectionMap) {
    sectionInstructions.push({
      sectionId,
      instructions: [`Fixes needed for section ${sectionId}:`, ...instructions].join("\n"),
    });
  }

  // Always add accessibility/interactivity guardrails when those categories have issues.
  const hasAccessibilityIssues = allIssues.some((i) => i.category === "accessibility");
  const hasInteractivityIssues = allIssues.some((i) => i.category === "interactivity");
  if (hasAccessibilityIssues) {
    globals.push(
      "- [GLOBAL] Ensure all images have descriptive alt text, form inputs have associated labels, and color contrast meets WCAG 2.1 AA.",
    );
  }
  if (hasInteractivityIssues) {
    globals.push(
      "- [GLOBAL] Implement the mobile navigation menu with Alpine.js x-data/x-show, ensure all buttons are clickable, and add aria-expanded/aria-controls where applicable.",
    );
  }

  const globalInstructions = globals.length > 0 ? globals.join("\n") : undefined;

  const brief: FixBrief = {
    appliedHeals: applied,
    sectionInstructions,
    globalInstructions,
  };

  const changed = applied.length > 0 || sectionInstructions.length > 0 || !!globalInstructions;

  return {
    content: nextContent,
    hierarchy: nextHierarchy,
    designSystem: nextDesignSystem,
    brief,
    changed,
  };
}

export default buildFixPlan;
