import { describe, test, expect } from "vitest";
import { buildTemplateShell } from "../../src/utils/template-shell";
import type { ScrapedWebsiteData } from "../../src/utils/scrape-docs";

const baseScrape: ScrapedWebsiteData = {
  url: "https://example-gym.com",
  title: "Beta Gym - Functional Fitness",
  description: "A community gym for functional fitness.",
  businessName: "Beta Gym",
  tagline: "Stronger together.",
  headings: ["Train with purpose", "Join today", "Our coaches"],
  paragraphs: ["We build fitness for real life.", "Group classes for every level."],
  buttons: ["Book a class", "Start free trial"],
  navLinks: [
    { label: "Classes", href: "/classes" },
    { label: "Coaches", href: "/coaches" },
  ],
  colors: [
    { token: "primary", hex: "#111111", role: "text", usage: "headings" },
    { token: "accent", hex: "#ff4d00", role: "accent", usage: "CTAs" },
  ],
  fonts: [{ family: "Inter", role: "body", weights: [400, 700] }],
  fontSizes: [{ element: "h1", desktop: "48px", mobile: "32px" }],
  images: [{ url: "https://example-gym.com/hero.jpg", context: "hero", promptKeywords: ["athletes", "gym"], alt: "Athletes training" }],
  layoutRules: [{ element: "section", value: "max-width 1200px, padding 80px vertical" }],
  faqs: [{ question: "Do you offer drop-ins?", answer: "Yes, $25 per class." }],
  testimonials: [{ quote: "Best gym in town.", author: "Jane D.", role: "Member" }],
  locations: [{ name: "Downtown", address: "123 Main St" }],
  team: [{ name: "Coach Alex", role: "Head coach", bio: "CSCS certified." }],
  offerings: [{ name: "Group class", description: "One hour", price: "$30" }],
  contact: { phone: "555-1234", email: "hi@example-gym.com", social: [{ platform: "Instagram", url: "https://instagram.com/betagym" }] },
  screenshotUrls: ["https://example-gym.com/screenshot.png"],
};

describe("buildTemplateShell", () => {
  test("produces a neutral theme with no brand colors", () => {
    const shell = buildTemplateShell(baseScrape);
    expect(shell.theme.colors.primary).toBe("#111111");
    expect(shell.theme.colors.accent).toBeUndefined();
    expect(shell.theme.colors.background).toBe("#ffffff");
    expect(shell.theme.fonts.heading).toBe("Sans-serif");
  });

  test("anonymizes page title and meta description", () => {
    const shell = buildTemplateShell(baseScrape);
    expect(shell.page.title).not.toContain("Beta Gym");
    expect(shell.page.metaTitle).not.toContain("Beta Gym");
    expect(shell.page.metaDescription).not.toContain("Beta Gym");
    expect(shell.page.title).toContain("{{business_name}}");
  });

  test("maps nav links, hero, offerings, team, reviews, location, and footer", () => {
    const shell = buildTemplateShell(baseScrape);
    const types = shell.page.sections.map((s) => s.type);
    expect(types).toContain("SiteHeader");
    expect(types).toContain("Hero");
    expect(types).toContain("Text");
    expect(types).toContain("SiteCardGroup");
    expect(types).toContain("SiteReviews");
    expect(types).toContain("SiteLocation");
    expect(types).toContain("SiteFooter");
  });

  test("records placeholders for every anonymized content slot", () => {
    const shell = buildTemplateShell(baseScrape);
    expect(shell.placeholders.length).toBeGreaterThan(0);
    expect(shell.placeholders.some((p) => p.label.includes("Hero headline"))).toBe(true);
    expect(shell.placeholders.some((p) => p.label.includes("Navigation label"))).toBe(true);
    expect(shell.placeholders.some((p) => p.propPath === "title" && p.sectionId === "hero-shell")).toBe(true);
  });

  test("does not leak original copy into section props", () => {
    const shell = buildTemplateShell(baseScrape);
    const hero = shell.page.sections.find((s) => s.id === "hero-shell")!;
    expect(hero.props.title).toMatch(/^\{\{placeholder-/);
    expect(hero.props.subtitle).toMatch(/^\{\{placeholder-/);
    expect(hero.props.cta.label).toMatch(/^\{\{placeholder-/);
  });

  test("every placeholder key used in props exists in the placeholder registry", () => {
    const shell = buildTemplateShell(baseScrape);
    const registered = new Set(shell.placeholders.map((p) => p.key));
    const used = new Set<string>();

    function collect(value: unknown) {
      if (typeof value === "string") {
        const matches = value.matchAll(/\{\{(placeholder-\d{3})[^}]*\}\}/g);
        for (const match of matches) {
          used.add(match[1]!);
        }
      } else if (Array.isArray(value)) {
        for (const item of value) collect(item);
      } else if (value && typeof value === "object") {
        for (const v of Object.values(value)) collect(v);
      }
    }

    collect(shell.page.sections);
    collect(shell.page.title);
    collect(shell.page.metaTitle);
    collect(shell.page.metaDescription);

    for (const key of used) {
      expect(registered).toContain(key);
    }
  });
});
