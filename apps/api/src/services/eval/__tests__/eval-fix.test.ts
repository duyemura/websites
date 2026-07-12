// apps/api/src/services/eval/__tests__/eval-fix.test.ts

import { describe, it, expect } from "vitest";
import { buildFixPlan } from "../eval-fix.js";
import type { PageEvalReport } from "../page-eval-report.js";
import type { GymSiteContent } from "@ploy-gyms/shared-types";
import type { SiteHierarchy } from "../../../types/site-hierarchy";
import type { DesignSystemV2 } from "../../../types/design-system-v2";

function makeReport(partial: Partial<PageEvalReport> = {}): PageEvalReport {
  return {
    overall: {
      score: 65,
      grade: "D",
      status: "failed",
      summary: "test summary",
      clientSummary: "test client summary",
      actionItems: [],
    },
    categories: [],
    metadata: { url: "https://example.com/", path: "/", title: null, h1: null, wordCount: 0, loadTimeMs: 0 },
    ...partial,
  };
}

function makeContent(): GymSiteContent {
  return {
    meta: {
      siteId: "site_123",
      apiBaseUrl: "https://api.example.com",
      siteUrl: "https://example.com",
      defaultTitle: "",
      defaultDescription: "",
    },
    business: {
      name: "Torrance Training Lab",
      tagline: "Strength and conditioning in Torrance.",
      address: { street: "123 Main", city: "Torrance", state: "California", zip: "90505" },
      phone: "555-1234",
      hours: [],
      geo: { city: "Torrance", state: "California", stateAbbr: "CA" },
      primaryCta: { label: "Join now", url: "/missing-page" },
    },
    brand: {
      primaryColor: "#000",
      secondaryColor: "#fff",
      accentColor: "#f00",
      headingFont: "Inter",
      bodyFont: "Inter",
      logoUrl: "",
      logoAlt: "Torrance Training Lab",
    },
    navigation: {
      header: [
        { label: "Home", href: "/" },
        { label: "About", href: "/about" },
        { label: "Old page", href: "/old-page" },
      ],
      footer: [{ label: "Company", links: [{ label: "Bad link", href: "/removed" }] }],
    },
    pages: {
      home: {
        hero: { headline: "Train hard", ctaLabel: "", ctaUrl: "" },
        valueProps: [],
        programsHeadline: "",
        featuredPrograms: [],
        features: [],
        communityHeadline: "",
        communityProps: [],
        trustHeadline: "",
        howItWorks: [],
        howItWorksHeadline: "",
        testimonials: [],
        faq: [],
      },
      programs: [],
      about: { hero: { headline: "About" } },
      pricing: { hero: { headline: "Pricing" } },
      contact: { hero: { headline: "Contact" } },
      schedule: { hero: { headline: "Schedule" } },
      blog: { heroHeadline: "Blog", posts: [] },
      legal: [],
    },
  };
}

function makeHierarchy(): SiteHierarchy {
  return {
    version: "1",
    siteMetadata: {
      businessName: "Torrance Training Lab",
      mode: "template",
      tier: "paid",
      generatedAt: new Date().toISOString(),
    },
    pages: [
      {
        slug: "index",
        isHomePage: true,
        title: "Home",
        sections: [{ id: "hero-1", tag: "hero", intent: "hero", content: {}, evidenceId: "ev1" }],
      },
    ],
    buildPlan: { nextPage: "index", pageStatus: { index: "planned" }, buildOrder: ["index"] },
  };
}

function makeDesignSystem(): DesignSystemV2 {
  return {
    version: "2",
    siteMetadata: { framework: "astro", mode: "template", generatedAt: new Date().toISOString() },
    global: {
      tokens: {
        colors: { primary: "#000", background: "#fff", foreground: "#111", muted: "#999", mutedForeground: "#666", border: "#ccc" },
        fonts: { heading: "Inter", body: "Inter" },
        spacing: {},
      },
      shell: {
        navLinks: [
          { label: "Home", href: "/" },
          { label: "Bad nav", href: "/not-a-page" },
        ],
      },
      rules: {},
    },
    brand: { logo: { type: "text", value: "TTL", alt: "Torrance Training Lab" }, headingStyle: { uppercase: false, bold: true } },
    business: { name: "Torrance Training Lab", tagline: "Strength and conditioning in Torrance." },
  };
}

describe("buildFixPlan", () => {
  it("applies deterministic SEO and CTA heals", () => {
    const report = makeReport({
      categories: [
        {
          name: "seo",
          score: 50,
          grade: "F",
          status: "failed",
          issues: [{ severity: "major", category: "seo", message: "Missing title tag", fix: "Add a unique title tag." }],
        },
      ],
    });

    const result = buildFixPlan({
      report,
      content: makeContent(),
      hierarchy: makeHierarchy(),
      designSystem: makeDesignSystem(),
      pageSlug: "index",
    });

    expect(result.changed).toBe(true);
    expect(result.hierarchy.pages[0]?.metaTitle).toBe("Home | Torrance Training Lab");
    expect(result.hierarchy.pages[0]?.metaDescription).toBe("Strength and conditioning in Torrance.");
    expect(result.content?.meta.defaultTitle).toBe("Home | Torrance Training Lab");
    expect(result.content?.business.primaryCta.url).toBe("/contact");
    expect(result.content?.pages.home.hero.ctaUrl).toBe("/contact");
    expect(result.content?.pages.home.hero.ctaLabel).toBe("Get started");
  });

  it("sanitizes broken internal links in navigation and footer", () => {
    const report = makeReport({
      categories: [
        {
          name: "links",
          score: 50,
          grade: "F",
          status: "failed",
          issues: [{ severity: "major", category: "links", message: "Broken internal link", fix: "Fix the link." }],
        },
      ],
    });

    const result = buildFixPlan({
      report,
      content: makeContent(),
      hierarchy: makeHierarchy(),
      designSystem: makeDesignSystem(),
      pageSlug: "index",
    });

    expect(result.content?.navigation.header.find((n) => n.label === "Old page")?.href).toBe("/contact");
    expect(result.content?.navigation.footer[0]?.links[0]?.href).toBe("/contact");
    expect(result.designSystem.global.shell.navLinks?.find((n) => n.label === "Bad nav")?.href).toBe("/contact");
  });

  it("builds section instructions from report issues", () => {
    const report = makeReport({
      categories: [
        {
          name: "visual",
          score: 60,
          grade: "D",
          status: "failed",
          issues: [
            { severity: "major", category: "visual", message: "Hero uses placeholder image", sectionId: "hero-1", fix: "Use a real hero background image." },
          ],
        },
      ],
    });

    const result = buildFixPlan({
      report,
      content: makeContent(),
      hierarchy: makeHierarchy(),
      designSystem: makeDesignSystem(),
      pageSlug: "index",
    });

    expect(result.brief.sectionInstructions).toHaveLength(1);
    expect(result.brief.sectionInstructions[0]?.sectionId).toBe("hero-1");
    expect(result.brief.sectionInstructions[0]?.instructions).toContain("Use a real hero background image");
  });

  it("does not route instructions to a section whose id is a substring of another", () => {
    const hierarchy: SiteHierarchy = {
      ...makeHierarchy(),
      pages: [
        {
          slug: "index",
          isHomePage: true,
          title: "Home",
          sections: [
            { id: "s1", tag: "hero", intent: "hero", content: {}, evidenceId: "ev1" },
            { id: "s10", tag: "cta-band", intent: "cta", content: {}, evidenceId: "ev2" },
          ],
        },
      ],
    };
    const report = makeReport({
      categories: [
        {
          name: "visual",
          score: 60,
          grade: "D",
          status: "failed",
          issues: [
            { severity: "major", category: "visual", message: "Hero uses placeholder image s10", fix: "Use a real hero background image." },
          ],
        },
      ],
    });

    const result = buildFixPlan({
      report,
      content: makeContent(),
      hierarchy,
      designSystem: makeDesignSystem(),
      pageSlug: "index",
    });

    expect(result.brief.sectionInstructions).toHaveLength(1);
    expect(result.brief.sectionInstructions[0]?.sectionId).toBe("s10");
  });

  it("does not add visual instructions when the report passes", () => {
    const report = makeReport({
      overall: { score: 98, grade: "A+", status: "passed", summary: "great", clientSummary: "great", actionItems: [] },
    });

    const content = makeContent();
    content.meta.defaultTitle = "Torrance Training Lab";
    content.meta.defaultDescription = "Strength and conditioning in Torrance.";
    content.business.primaryCta = { label: "Get started", url: "/contact" };
    content.pages.home.hero.ctaLabel = "Get started";
    content.pages.home.hero.ctaUrl = "/contact";
    content.navigation.header = [{ label: "Home", href: "/" }];
    content.navigation.footer = [{ label: "Company", links: [{ label: "Contact", href: "/contact" }] }];

    const designSystem = makeDesignSystem();
    designSystem.global.shell.navLinks = [{ label: "Home", href: "/" }];

    const result = buildFixPlan({
      report,
      content,
      hierarchy: makeHierarchy(),
      designSystem,
      pageSlug: "index",
    });

    expect(result.brief.sectionInstructions).toHaveLength(0);
    expect(result.brief.globalInstructions).toBeUndefined();
  });
});
