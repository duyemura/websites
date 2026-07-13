// apps/api/src/services/eval/__tests__/fidelity.test.ts

import { describe, test, expect, vi } from "vitest";
import type { CheckContext } from "../checks/check-context.js";
import { checkTemplateFidelity, checkStructureFidelity } from "../checks/fidelity.js";
import type { GymSiteContent } from "@milo/shared-types";

vi.mock("../../../utils/site-hierarchy-io.js", () => ({
  loadSiteHierarchyDoc: vi.fn(),
}));

import { loadSiteHierarchyDoc } from "../../../utils/site-hierarchy-io.js";

const mockedLoadSiteHierarchyDoc = vi.mocked(loadSiteHierarchyDoc);

function makePage(html: string) {
  return {
    content: vi.fn().mockResolvedValue(html),
    title: vi.fn().mockResolvedValue("Test Page"),
    evaluate: vi.fn().mockResolvedValue({}),
  } as unknown as CheckContext["page"];
}

function makeDb() {
  return {} as CheckContext["db"];
}

function makeCtx(
  content: GymSiteContent | undefined,
  path: string,
  html: string,
  siteMode?: CheckContext["siteMode"],
): CheckContext {
  return {
    page: makePage(html),
    browser: {} as CheckContext["browser"],
    url: `https://example.com${path}`,
    path,
    content,
    db: makeDb(),
    siteUuid: "site-1",
    workspaceUuid: "ws-1",
    siteMode,
    log: () => {},
  };
}

function baseContent(): GymSiteContent {
  return {
    meta: {
      siteId: "site-1",
      apiBaseUrl: "https://api.example.com",
      siteUrl: "https://example.com",
      defaultTitle: "Test Gym",
      defaultDescription: "A great gym",
      templateTheme: "beanburito",
    },
    business: {
      name: "Test Gym",
      tagline: "The best gym in town",
      address: { street: "123 Main St", city: "Torrance", state: "California", zip: "90501" },
      phone: "(310) 555-1234",
      hours: [],
      primaryCta: { label: "Start your free trial", url: "/contact" },
      geo: { city: "Torrance", state: "California", stateAbbr: "CA" },
    },
    brand: {
      primaryColor: "#000",
      secondaryColor: "#fff",
      accentColor: "#0040a5",
      headingFont: "Inter",
      bodyFont: "Inter",
      logoUrl: "__NO_IMAGE__",
      logoAlt: "Test Gym logo",
    },
    navigation: {
      header: [
        { label: "Programs", href: "/programs" },
        { label: "About", href: "/about" },
      ],
      footer: [],
    },
    pages: {
      home: {
        hero: {
          headline: "Build Strength. Find Your Community.",
          subheading: "Best Gym in Torrance",
          intro: "Trusted by 400+ Torrance residents since 2018.",
          ctaLabel: "Start Your Free Trial",
          ctaUrl: "/contact",
        },
        valueProps: [],
        programsHeadline: "Programs Built For You",
        featuredPrograms: ["crossfit"],
        features: [],
        communityHeadline: "A Community That Keeps You Going",
        communityProps: [],
        trustHeadline: "Trusted by 500+ Members in Torrance",
        howItWorks: [],
        howItWorksHeadline: "Getting Started Is Simple",
        testimonials: [{ quote: "This gym changed my life.", name: "Alex" }],
        faq: [{ question: "What should I bring?", answer: "Water and shoes." }],
      },
      programs: [
        {
          slug: "crossfit",
          name: "CrossFit",
          shortDescription: "Constantly varied functional fitness.",
          coverImageUrl: "__NO_IMAGE__",
          hero: { headline: "CrossFit in Torrance" },
          whatIsIt: { headline: "", body: "" },
          whatMakesUsDifferent: [],
          whatToExpect: { headline: "", steps: [] },
          whoIsItFor: [],
          gettingStarted: [],
          testimonials: [],
          faq: [],
        },
      ],
      about: { hero: { headline: "About Test Gym" }, gymStory: "", team: [] },
      contact: { hero: { headline: "Contact Us" } },
      pricing: { hero: { headline: "Pricing" } },
      schedule: { hero: { headline: "Schedule" } },
      blog: { heroHeadline: "Blog", posts: [] },
      legal: [],
    },
  };
}

describe("checkTemplateFidelity", () => {
  test("flags missing business name, city, phone, and CTA", async () => {
    const ctx = makeCtx(baseContent(), "/", "<html><body><h1>Welcome</h1><p>Generic gym page.</p></body></html>");
    const issues = await checkTemplateFidelity(ctx);

    const messages = issues.map((i) => i.message);
    expect(messages.some((m) => m.includes("Test Gym"))).toBe(true);
    expect(messages.some((m) => m.includes("Torrance"))).toBe(true);
    expect(messages.some((m) => m.includes("phone") || m.includes("(310) 555-1234"))).toBe(true);
    expect(messages.some((m) => m.includes("Start your free trial"))).toBe(true);
    expect(messages.some((m) => m.includes("Build Strength. Find Your Community."))).toBe(true);
    expect(messages.some((m) => m.includes("CrossFit"))).toBe(true);
  });

  test("passes when all expected content is rendered", async () => {
    const html = `
      <html><body>
        <nav><a href="/programs">Programs</a><a href="/about">About</a></nav>
        <section data-section="hero"><h1>Build Strength. Find Your Community.</h1></section>
        <section data-section="programs"><h3>CrossFit</h3></section>
        <section data-section="testimonials"><blockquote>This gym changed my life.</blockquote></section>
        <section data-section="faq"><details><summary>What should I bring?</summary></details></section>
        <a href="/contact">Start your free trial</a>
        <footer>Test Gym, 123 Main St, Torrance, California 90501</footer>
        <a href="tel:3105551234">(310) 555-1234</a>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html);
    const issues = await checkTemplateFidelity(ctx);
    const actionable = issues.filter((i) => i.severity !== "info");
    expect(actionable).toHaveLength(0);
  });

  test("info issue when gym.json is unavailable", async () => {
    const ctx = makeCtx(undefined, "/", "<html><body></body></html>");
    const issues = await checkTemplateFidelity(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("info");
  });

  test("does not confuse similar hrefs for the primary CTA", async () => {
    const html = `
      <html><body>
        <nav><a href="/programs">Programs</a><a href="/about">About</a></nav>
        <section data-section="hero"><h1>Build Strength. Find Your Community.</h1></section>
        <section data-section="programs"><h3>CrossFit</h3></section>
        <section data-section="testimonials"><blockquote>This gym changed my life.</blockquote></section>
        <section data-section="faq"><details><summary>What should I bring?</summary></details></section>
        <a href="/contact-us">Start your free trial</a>
        <footer>Test Gym, 123 Main St, Torrance, California 90501</footer>
        <a href="tel:3105551234">(310) 555-1234</a>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html);
    const issues = await checkTemplateFidelity(ctx);
    const ctaIssue = issues.find((i) => i.message.includes("Primary CTA"));
    expect(ctaIssue).toBeDefined();
    expect(ctaIssue?.message).toContain("href did not match");
  });
});

describe("checkStructureFidelity", () => {
  test("flags missing declared sections from site-hierarchy", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue({
      version: "1",
      siteMetadata: { framework: "astro", mode: "template", generatedAt: "2026-01-01", businessName: "Test Gym" },
      pages: [
        {
          slug: "index",
          isHomePage: true,
          title: "Home",
          sections: [
            { id: "s1", tag: "hero", intent: "hero", content: { heading: "Build Strength" }, evidenceId: "e1" },
            { id: "s2", tag: "cta-band", intent: "cta", content: {}, evidenceId: "e2" },
            { id: "s3", tag: "faq-block", intent: "faq", content: {}, evidenceId: "e3" },
          ],
        },
      ],
      buildPlan: { nextPage: "", pageStatus: {}, buildOrder: [] },
    });

    const html = `
      <html><body>
        <section data-section-tag="hero"><h1>Build Strength</h1></section>
        <section data-section-tag="cta-band"><a href="/contact">Join</a></section>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html);
    const issues = await checkStructureFidelity(ctx);

    const missing = issues.find((i) => i.message.includes('faq-block'));
    expect(missing).toBeDefined();
    expect(missing?.severity).toBe("major");
  });

  test("detects sections in expected order", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue({
      version: "1",
      siteMetadata: { framework: "astro", mode: "template", generatedAt: "2026-01-01", businessName: "Test Gym" },
      pages: [
        {
          slug: "index",
          isHomePage: true,
          title: "Home",
          sections: [
            { id: "s1", tag: "hero", intent: "hero", content: {}, evidenceId: "e1", styleHint: { sourceOrder: 0 } },
            { id: "s2", tag: "feature-grid", intent: "features", content: {}, evidenceId: "e2", styleHint: { sourceOrder: 1 } },
            { id: "s3", tag: "cta-band", intent: "cta", content: {}, evidenceId: "e3", styleHint: { sourceOrder: 2 } },
          ],
        },
      ],
      buildPlan: { nextPage: "", pageStatus: {}, buildOrder: [] },
    });

    const html = `
      <html><body>
        <section data-section-tag="hero"><h1>Test Gym</h1></section>
        <section data-section-tag="feature-grid" class="grid"></section>
        <section data-section-tag="cta-band" data-section="ctaBand"></section>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html);
    const issues = await checkStructureFidelity(ctx);
    expect(issues).toHaveLength(0);
  });

  test("flags wrong section order", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue({
      version: "1",
      siteMetadata: { framework: "astro", mode: "template", generatedAt: "2026-01-01", businessName: "Test Gym" },
      pages: [
        {
          slug: "index",
          isHomePage: true,
          title: "Home",
          sections: [
            { id: "s1", tag: "hero", intent: "hero", content: {}, evidenceId: "e1", styleHint: { sourceOrder: 0 } },
            { id: "s2", tag: "feature-grid", intent: "features", content: {}, evidenceId: "e2", styleHint: { sourceOrder: 1 } },
            { id: "s3", tag: "cta-band", intent: "cta", content: {}, evidenceId: "e3", styleHint: { sourceOrder: 2 } },
          ],
        },
      ],
      buildPlan: { nextPage: "", pageStatus: {}, buildOrder: [] },
    });

    const html = `
      <html><body>
        <section data-section-tag="feature-grid" class="grid"></section>
        <section data-section-tag="hero"><h1>Test Gym</h1></section>
        <section data-section-tag="cta-band" data-section="ctaBand"></section>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html);
    const issues = await checkStructureFidelity(ctx);
    expect(issues.some((i) => i.message.includes("not in the order"))).toBe(true);
  });

  test("info issue when site-hierarchy is unavailable", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue(null);
    const ctx = makeCtx(baseContent(), "/", "<html><body></body></html>");
    const issues = await checkStructureFidelity(ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("info");
  });

  test("uses registry spec for template-mode sites", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue(null);
    const html = `
      <html><body>
        <section data-section="hero"></section>
        <section data-section="valueProps"></section>
        <section data-section="programs"></section>
        <section data-section="howItWorks"></section>
        <section data-section="amenities"></section>
        <section data-section="community"></section>
        <section data-section="location"></section>
        <section data-section="testimonials"></section>
        <section data-section="faq"></section>
        <section data-section="ctaBand"></section>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html, "template");
    const issues = await checkStructureFidelity(ctx);
    expect(issues).toHaveLength(0);
  });

  test("flags missing registry components for template-mode sites", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue(null);
    const html = `
      <html><body>
        <section data-section="hero"></section>
        <section data-section="ctaBand"></section>
        <section data-section="location"></section>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html, "template");
    const issues = await checkStructureFidelity(ctx);
    const missing = issues.filter((i) => i.message.includes("Expected section"));
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((i) => i.message.includes('"valueProps"'))).toBe(true);
  });

  test("flags wrong component order for template-mode sites", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue(null);
    const html = `
      <html><body>
        <section data-section="programs"></section>
        <section data-section="hero"></section>
        <section data-section="valueProps"></section>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html, "template");
    const issues = await checkStructureFidelity(ctx);
    expect(issues.some((i) => i.message.includes("not in the order"))).toBe(true);
  });

  test("flags unexpected sections for template-mode sites", async () => {
    mockedLoadSiteHierarchyDoc.mockResolvedValue(null);
    const html = `
      <html><body>
        <section data-section="hero"></section>
        <section data-section="valueProps"></section>
        <section data-section="programs"></section>
        <section data-section="howItWorks"></section>
        <section data-section="amenities"></section>
        <section data-section="community"></section>
        <section data-section="testimonials"></section>
        <section data-section="faq"></section>
        <section data-section="ctaBand"></section>
        <section data-section="location"></section>
        <section data-section="extraWidget"></section>
      </body></html>
    `;
    const ctx = makeCtx(baseContent(), "/", html, "template");
    const issues = await checkStructureFidelity(ctx);
    expect(issues.some((i) => i.message.includes("extraWidget"))).toBe(true);
  });
});
