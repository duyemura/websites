import { describe, test, expect } from "vitest";
import { buildSiteBlueprint, deriveSlug } from "../../src/utils/site-blueprint";
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
    { label: "About", href: "/about" },
  ],
  colors: [
    { token: "primary", hex: "#111111", role: "text", usage: "headings" },
    { token: "accent", hex: "#ff4d00", role: "accent", usage: "CTAs" },
    { token: "background", hex: "#ffffff", role: "background", usage: "canvas" },
  ],
  fonts: [{ family: "Inter", role: "body", weights: [400, 700] }],
  fontSizes: [{ element: "h1", desktop: "48px", mobile: "32px" }],
  images: [{ url: "https://example-gym.com/hero.jpg", context: "hero", promptKeywords: ["athletes", "gym"], alt: "Athletes training" }],
  layoutRules: [{ element: "section", value: "max-width 1200px, padding 80px vertical" }],
  faqs: [{ question: "Do you offer drop-ins?", answer: "Yes, $25 per class." }],
  testimonials: [{ quote: "Best gym in town.", author: "Jane D.", role: "Member" }],
  locations: [{ name: "Downtown", address: "123 Main St", hours: "Mon-Fri 5am-10pm" }],
  team: [{ name: "Coach Alex", role: "Head coach", bio: "CSCS certified." }],
  offerings: [{ name: "Group class", description: "One hour", price: "$30" }],
  contact: { phone: "555-1234", email: "hi@example-gym.com", social: [] },
  screenshotUrls: ["https://example-gym.com/screenshot.png"],
};

describe("buildSiteBlueprint", () => {
  test("populates site metadata from scrape", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.site_metadata.target_url).toBe("https://example-gym.com");
    expect(bp.site_metadata.framework).toBe("astro");
    expect(bp.site_metadata.mode).toBe("replication");
    expect(bp.site_metadata.business_name).toBe("Beta Gym");
    expect(bp.site_metadata.generated_at).toMatch(/^\d{4}-/);
  });

  test("derives design tokens from scraped colors and fonts", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.design_tokens.colors.primary).toBe("#ff4d00");
    expect(bp.design_tokens.colors.background).toBe("#ffffff");
    expect(bp.design_tokens.fonts.body).toBe("Inter");
    expect(bp.design_tokens.radius).toBe("0.5rem");
  });

  test("builds global header and footer from real scraped values", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.global_shell.header?.type).toBe("SiteHeader");
    expect(bp.global_shell.header?.props.logo).toEqual({
      type: "text",
      value: baseScrape.businessName,
    });
    expect(bp.global_shell.header?.props.navLinks).toEqual(baseScrape.navLinks);
    expect(bp.global_shell.header?.props.ctaLabel).toBe(baseScrape.buttons[0]);
    expect(bp.global_shell.footer?.type).toBe("SiteFooter");
    expect(bp.global_shell.footer?.props.businessName).toBe(baseScrape.businessName);
    expect(bp.global_shell.footer?.props.navLinks).toEqual(baseScrape.navLinks);
    expect(bp.global_shell.footer?.props.socialLinks).toEqual(baseScrape.contact.social);
    expect(bp.global_shell.footer?.props.copyright).toMatch(
      new RegExp(`© ${new Date().getFullYear()} ${baseScrape.businessName}\\. All rights reserved\\.`),
    );
    expect(bp.global_shell.navLinks).toEqual(baseScrape.navLinks);
    expect(bp.global_shell.theme).toEqual(bp.design_tokens);
  });

  test("homepage uses real scraped values without duplicating global header/footer", () => {
    const bp = buildSiteBlueprint(baseScrape);
    const home = bp.pages.find((p) => p.isHomePage)!;
    expect(home.slug).toBe("index");
    expect(home.title).toBe(baseScrape.title);
    expect(home.metaTitle).toBe(baseScrape.title);
    expect(home.metaDescription).toBe(baseScrape.description);

    const types = home.sections.map((s) => s.type);
    expect(types).toContain("Hero");
    expect(types).not.toContain("SiteHeader");
    expect(types).not.toContain("SiteFooter");

    const hero = home.sections.find((s) => s.type === "Hero")!;
    expect(hero.props.title).toBe(baseScrape.headings[0]);
    expect(hero.props.subtitle).toBe(baseScrape.paragraphs[0]);
    expect(hero.props.cta.label).toBe(baseScrape.buttons[0]);
    expect(hero.props.title).not.toContain("{{placeholder-");
    expect(hero.props.subtitle).not.toContain("{{placeholder-");

    const about = home.sections.find((s) => s.type === "Text" && s.props.title === "About us");
    expect(about?.props.body).toBe(baseScrape.description);

    const offerings = home.sections.find((s) => s.type === "SiteCardGroup");
    expect(offerings?.props.cards).toEqual([
      { title: baseScrape.offerings[0].name, description: baseScrape.offerings[0].description },
    ]);

    const reviews = home.sections.find((s) => s.type === "SiteReviews");
    expect(reviews?.props.reviews).toEqual([
      { quote: baseScrape.testimonials[0].quote, author: "Jane D., Member" },
    ]);

    const location = home.sections.find((s) => s.type === "SiteLocation");
    expect(location?.props.phone).toBe(baseScrape.contact.phone);
  });

  test("infers secondary pages from nav links", () => {
    const bp = buildSiteBlueprint(baseScrape);
    expect(bp.pages.find((p) => p.slug === "classes")).toBeDefined();
    expect(bp.pages.find((p) => p.slug === "coaches")).toBeDefined();
    expect(bp.pages.find((p) => p.slug === "about")).toBeDefined();

    const classes = bp.pages.find((p) => p.slug === "classes")!;
    expect(classes.sections.some((s) => s.type === "SiteCardGroup")).toBe(true);
    const classesCardGroup = classes.sections.find((s) => s.type === "SiteCardGroup")!;
    expect(classesCardGroup.props.cards).toEqual([
      { title: baseScrape.offerings[0].name, description: baseScrape.offerings[0].description },
    ]);

    const about = bp.pages.find((p) => p.slug === "about")!;
    expect(about.sections.some((s) => s.type === "Text")).toBe(true);
  });

  test("falls back to neutral tokens when scrape lacks brand data", () => {
    const minimal: ScrapedWebsiteData = {
      ...baseScrape,
      colors: [],
      fonts: [],
      designTokens: [],
    };
    const bp = buildSiteBlueprint(minimal);
    expect(bp.design_tokens.colors.primary).toBe("#111111");
    expect(bp.design_tokens.colors.background).toBe("#ffffff");
    expect(bp.design_tokens.fonts.heading).toBe("Sans-serif");
    expect(bp.design_tokens.fonts.body).toBe("Sans-serif");
  });

  test("derives muted and mutedForeground from surface and textMuted roles", () => {
    const bp = buildSiteBlueprint({
      ...baseScrape,
      colors: [
        { token: "surface", hex: "#f0f0f0", role: "surface", usage: "cards" },
        { token: "textMuted", hex: "#666666", role: "textMuted", usage: "secondary text" },
      ],
    });
    expect(bp.design_tokens.colors.muted).toBe("#f0f0f0");
    expect(bp.design_tokens.colors.mutedForeground).toBe("#666666");
  });

  test("skips emitting secondary pages that would have no content", () => {
    const bp = buildSiteBlueprint({
      ...baseScrape,
      navLinks: [{ label: "Pricing", href: "/pricing" }],
      offerings: [],
      description: "",
      paragraphs: [],
    });
    expect(bp.pages.find((p) => p.slug === "pricing")).toBeUndefined();
  });

  test("blueprint contains no template placeholders", () => {
    const bp = buildSiteBlueprint(baseScrape);
    const json = JSON.stringify(bp);
    expect(json).not.toContain("{{placeholder-");
  });

  test("filters external nav links and does not create secondary pages for them", () => {
    const bp = buildSiteBlueprint({
      ...baseScrape,
      navLinks: [
        { label: "External", href: "https://external.com" },
        { label: "Anchor", href: "#features" },
        { label: "Home", href: "/" },
        { label: "Classes", href: "/classes" },
      ],
    });
    const slugs = bp.pages.map((p) => p.slug);
    expect(slugs).toContain("index");
    expect(slugs).toContain("classes");
    expect(slugs).not.toContain("external");
    expect(slugs).not.toContain("anchor");
    expect(slugs).not.toContain("home");
  });

  test("deriveSlug strips query strings from relative paths", () => {
    expect(deriveSlug("/classes?plan=monthly", "classes")).toBe("classes");
    expect(deriveSlug("/classes#schedule", "classes")).toBe("classes");
    expect(deriveSlug("/membership?plan=monthly#faq", "membership")).toBe("membership");
  });

  test("coaches page maps team members to card title and description", () => {
    const bp = buildSiteBlueprint({
      ...baseScrape,
      navLinks: [{ label: "Coaches", href: "/coaches" }],
      team: [
        { name: "Coach Alex", role: "Head coach", bio: "CSCS certified." },
        { name: "Coach Sam", role: "Trainer", bio: "Yoga specialist." },
      ],
    });
    const coaches = bp.pages.find((p) => p.slug === "coaches")!;
    const teamSection = coaches.sections.find((s) => s.type === "SiteCardGroup")!;
    expect(teamSection.props.cards).toEqual([
      { title: "Coach Alex", description: "CSCS certified." },
      { title: "Coach Sam", description: "Yoga specialist." },
    ]);
  });

  test("location section includes hours and phone when available", () => {
    const bp = buildSiteBlueprint(baseScrape);
    const home = bp.pages.find((p) => p.isHomePage)!;
    const location = home.sections.find((s) => s.type === "SiteLocation")!;
    expect(location.props.hours).toBe("Mon-Fri 5am-10pm");
    expect(location.props.phone).toBe(baseScrape.contact.phone);
    expect(location.props.address).toContain("Downtown");
    expect(location.props.address).toContain("123 Main St");
  });
});
