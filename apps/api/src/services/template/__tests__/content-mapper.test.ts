import { describe, test, expect } from "vitest";
import { DEFAULT_TEMPLATE_TOKENS, DEFAULT_BUSINESS_PLACEHOLDER } from "@ploy-gyms/shared-types/template-baseline";
import {
  extractBrand,
  extractBusiness,
  extractNavigation,
  extractPages,
  classifyPage,
  sanitizeInternalUrl,
  sanitizeContentCtas,
} from "../content-mapper";
import type { DesignSystemV2 } from "../../../types/design-system-v2";
import type { SiteHierarchy, HierarchyPage } from "../../../types/site-hierarchy";

// ── Fixtures ────────────────────────────────────────────────────────────────

const DS: DesignSystemV2 = {
  version: "2",
  siteMetadata: { framework: "astro", mode: "replication", businessName: "KSA", generatedAt: "" },
  global: {
    tokens: {
      colors: {
        primary: "#e63946",
        primaryForeground: "#fff",
        background: "#0d0d0d",
        foreground: "#f1f1f1",
        muted: "#333",
        mutedForeground: "#999",
        border: "#222",
      },
      fonts: { heading: "Barlow Condensed", body: "Inter" },
      radius: "4px",
    },
    shell: {},
    rules: {},
  },
  business: { name: "KS Athletic Club", tagline: "Train harder. Live better." },
  brand: {
    logo: { type: "image", value: "https://cdn.example.com/logo.png", alt: "KSA logo" },
    headingStyle: { uppercase: true, bold: true },
  },
  reference: {
    homePagePrimaryCta: { label: "Start free trial", href: "/contact" },
  },
};

const BUSINESS_MD = `# KS Athletic Club

**Tagline**: Train harder. Live better.
**Summary**: Premier CrossFit and functional fitness gym in Torrance, CA.

## Classification

- **Industry / niche**: Fitness / CrossFit
- **Service model**: Membership + drop-in
- **Primary audience**: Adults 18-45

## Contact

- **Phone**: (310) 555-0123
- **Email**: info@ksathleticclub.com
- **Website**: https://ksathleticclub.com

## Location

- **Address**: 1234 Fitness Ave, Torrance, CA 90503

**Hours**

- Monday: 5:00am - 10:00pm
- Tuesday: 5:00am - 10:00pm
`;

const makeHierarchy = (pages: Partial<HierarchyPage>[]): SiteHierarchy => ({
  version: "1",
  siteMetadata: { framework: "astro", mode: "replication", generatedAt: "" },
  pages: pages.map((p, i) => ({
    slug: p.slug ?? `page-${i}`,
    isHomePage: p.isHomePage ?? false,
    title: p.title ?? `Page ${i}`,
    sections: p.sections ?? [],
    heroImageUrl: p.heroImageUrl,
    pageType: p.pageType ?? "interior",
    ...p,
  })),
  buildPlan: { nextPage: "", pageStatus: {}, buildOrder: [] },
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("extractBrand", () => {
  test("maps design-system tokens to BrandTokens", () => {
    const warnings: string[] = [];
    const brand = extractBrand(DS, warnings);
    expect(brand.primaryColor).toBe("#0d0d0d");
    expect(brand.secondaryColor).toBe("#0d0d0d");
    expect(brand.accentColor).toBe("#e63946");
    expect(brand.headingFont).toBe("Barlow Condensed");
    expect(brand.bodyFont).toBe("Inter");
    expect(brand.logoUrl).toBe("https://cdn.example.com/logo.png");
    expect(brand.logoAlt).toBe("KSA logo");
    expect(warnings).toHaveLength(0);
  });

  test("falls back to defaults when tokens are empty strings", () => {
    const warnings: string[] = [];
    const sparse: DesignSystemV2 = {
      ...DS,
      global: {
        ...DS.global,
        tokens: {
          ...DS.global.tokens,
          colors: { ...DS.global.tokens.colors, primary: "" },
          fonts: { heading: "", body: "" },
        },
      },
      brand: { logo: { type: "text", value: "KSA" }, headingStyle: { uppercase: false, bold: false } },
    };
    const brand = extractBrand(sparse, warnings);
    expect(brand.primaryColor).toBe("#0d0d0d");
    expect(brand.headingFont).toBe(DEFAULT_TEMPLATE_TOKENS.fonts.heading);
    expect(brand.bodyFont).toBe(DEFAULT_TEMPLATE_TOKENS.fonts.body);
    expect(brand.logoUrl).toBe("");
    expect(warnings.some((w) => w.includes("headingFont"))).toBe(true);
    expect(warnings.some((w) => w.includes("bodyFont"))).toBe(true);
  });
});

describe("extractBusiness", () => {
  test("extracts name, tagline, phone, email from markdown + design-system", () => {
    const warnings: string[] = [];
    const biz = extractBusiness(BUSINESS_MD, DS, warnings);
    expect(biz.name).toBe("KS Athletic Club");
    expect(biz.tagline).toBe("Train harder. Live better.");
    expect(biz.phone).toBe("(310) 555-0123");
    expect(biz.email).toBe("info@ksathleticclub.com");
    expect(biz.address.city).toBe("Torrance");
    expect(biz.address.state).toBe("CA");
    expect(biz.address.zip).toBe("90503");
    expect(biz.primaryCta.label).toBe("Start free trial");
    expect(biz.geo.city).toBe("Torrance");
    expect(biz.geo.stateAbbr).toBe("CA");
  });

  test("falls back to default placeholder when markdown has no address", () => {
    const warnings: string[] = [];
    const biz = extractBusiness("No address here.", DS, warnings);
    expect(biz.address.street).toBe(DEFAULT_BUSINESS_PLACEHOLDER.address.street);
    expect(biz.address.city).toBe(DEFAULT_BUSINESS_PLACEHOLDER.address.city);
    expect(warnings.some((w) => w.includes("address"))).toBe(true);
  });

  test("uses baseline CTA when design-system has none", () => {
    const warnings: string[] = [];
    const noCtaDS: DesignSystemV2 = { ...DS, reference: { homePagePrimaryCta: null } };
    const biz = extractBusiness("", noCtaDS, warnings);
    expect(biz.primaryCta).toEqual(DEFAULT_BUSINESS_PLACEHOLDER.primaryCta);
  });

  test("parses GMB-format address with full state name (- **Address**: street, city, StateName, zip)", () => {
    // GMB enrichment writes full state name, not abbreviation
    const gmbMd = `# Torrance Training Lab
**Description**: Premier gym in Torrance.
## Location
- **Address**: 23510 Telo Avenue, Torrance, California, 90505
## Contact
- **Phone**: (310) 730-0044`;
    const warnings: string[] = [];
    const biz = extractBusiness(gmbMd, DS, warnings);
    expect(biz.address.street).toBe("23510 Telo Avenue");
    expect(biz.address.city).toBe("Torrance");
    expect(biz.address.state).toBe("CA"); // full "California" → abbreviation
    expect(biz.address.zip).toBe("90505");
    expect(biz.geo.city).toBe("Torrance");
    expect(biz.geo.stateAbbr).toBe("CA");
    expect(biz.phone).toBe("(310) 730-0044");
  });

  test("parses dash-prefixed labeled fields (- **Phone**: ...)", () => {
    // Some doc formats prefix labels with "- "
    const md = `## Contact\n- **Phone**: (555) 867-5309\n- **Email**: hello@gym.com`;
    const warnings: string[] = [];
    const biz = extractBusiness(md, DS, warnings);
    expect(biz.phone).toBe("(555) 867-5309");
    expect(biz.email).toBe("hello@gym.com");
  });
});

describe("classifyPage", () => {
  const cases: [string, string, boolean, ReturnType<typeof classifyPage>][] = [
    ["", "", true, "home"],
    ["about-us", "About Us", false, "about"],
    ["contact", "Contact", false, "contact"],
    ["pricing", "Pricing", false, "pricing"],
    ["membership", "Membership", false, "pricing"],
    ["schedule", "Schedule", false, "schedule"],
    ["blog", "Blog", false, "blog"],
    ["privacy-policy", "Privacy", false, "legal"],
    ["terms-of-service", "Terms", false, "legal"],
    ["crossfit", "CrossFit", false, "program"],
    ["bootcamp", "Bootcamp", false, "program"],
    ["personal-training", "PT", false, "program"],
  ];

  test.each(cases)("slug=%s → %s", (slug, title, isHomePage, expected) => {
    const page: HierarchyPage = {
      slug, title, isHomePage, sections: [], pageType: "interior",
    };
    expect(classifyPage(page)).toBe(expected);
  });
});

describe("extractNavigation", () => {
  test("builds header from non-legal non-blog pages", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home" },
      { slug: "crossfit", title: "CrossFit" },
      { slug: "about", title: "About" },
      { slug: "privacy-policy", title: "Privacy" },
    ]);
    const nav = extractNavigation(h, warnings);
    expect(nav.header.map((n) => n.href)).toEqual(["/", "/crossfit", "/about"]);
    expect(nav.header.find((n) => n.href === "/privacy-policy")).toBeUndefined();
  });

  test("groups footer by Company / Programs / Legal", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home" },
      { slug: "crossfit", title: "CrossFit" },
      { slug: "about", title: "About" },
      { slug: "contact", title: "Contact" },
      { slug: "privacy-policy", title: "Privacy" },
    ]);
    const nav = extractNavigation(h, warnings);
    const groups = Object.fromEntries(nav.footer.map((g) => [g.label, g.links.map((l) => l.href)]));
    expect(groups["Company"]).toContain("/about");
    expect(groups["Company"]).toContain("/contact");
    expect(groups["Programs"]).toContain("/crossfit");
    expect(groups["Legal"]).toContain("/privacy-policy");
  });

  test("omits empty footer groups", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([{ slug: "", isHomePage: true, title: "Home" }]);
    const nav = extractNavigation(h, warnings);
    expect(nav.footer.every((g) => g.links.length > 0)).toBe(true);
  });
});

describe("sanitizeInternalUrl", () => {
  const allowed = new Set(["/", "/about", "/contact", "/programs", "/programs/group-strength"]);

  test("preserves external URLs, anchors, mailto, and tel", () => {
    const warnings: string[] = [];
    expect(sanitizeInternalUrl("https://example.com", allowed, "/contact", warnings, "test")).toBe("https://example.com");
    expect(sanitizeInternalUrl("mailto:hi@gym.com", allowed, "/contact", warnings, "test")).toBe("mailto:hi@gym.com");
    expect(sanitizeInternalUrl("tel:5551234", allowed, "/contact", warnings, "test")).toBe("tel:5551234");
    expect(sanitizeInternalUrl("#faq", allowed, "/contact", warnings, "test")).toBe("#faq");
    expect(warnings).toHaveLength(0);
  });

  test("preserves valid internal paths", () => {
    const warnings: string[] = [];
    expect(sanitizeInternalUrl("/about", allowed, "/contact", warnings, "test")).toBe("/about");
    expect(sanitizeInternalUrl("/programs/group-strength", allowed, "/contact", warnings, "test")).toBe("/programs/group-strength");
    expect(sanitizeInternalUrl("/programs/", allowed, "/contact", warnings, "test")).toBe("/programs/");
    expect(warnings).toHaveLength(0);
  });

  test("replaces invalid internal paths with fallback and warns", () => {
    const warnings: string[] = [];
    expect(sanitizeInternalUrl("/programs/get-started", allowed, "/contact", warnings, "hero")).toBe("/contact");
    expect(sanitizeInternalUrl("/drop-in", allowed, "/contact", warnings, "hero")).toBe("/contact");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("/programs/get-started");
  });
});

describe("sanitizeContentCtas", () => {
  test("sanitizes stale business.primaryCta.url and all hero CTAs", () => {
    const warnings: string[] = [];
    const business = {
      name: "KSA",
      tagline: "Train hard.",
      address: { street: "", city: "Torrance", state: "CA", zip: "90505" },
      phone: "",
      email: "",
      hours: [],
      primaryCta: { label: "Get Started", url: "/programs/get-started" },
      geo: { city: "Torrance", state: "California", stateAbbr: "CA" },
    } as any;
    const pages = {
      home: { hero: { headline: "", ctaLabel: "Join", ctaUrl: "/drop-in" }, valueProps: [], programsHeadline: "", featuredPrograms: [], features: [], communityHeadline: "", communityProps: [], trustHeadline: "", howItWorks: [], howItWorksHeadline: "", testimonials: [], faq: [] },
      programs: [{ slug: "group-strength", name: "Group Strength", shortDescription: "", coverImageUrl: "", hero: { headline: "", ctaUrl: "/programs/get-started" }, whatIsIt: { headline: "", body: "" }, whatMakesUsDifferent: [], whatToExpect: { headline: "", steps: [] }, whoIsItFor: [], gettingStarted: [], testimonials: [], faq: [] }],
      about: { hero: { headline: "" }, gymStory: "", team: [] },
      pricing: { hero: { headline: "" } },
      contact: { hero: { headline: "" } },
      schedule: { hero: { headline: "" } },
      blog: { heroHeadline: "", posts: [] },
      legal: [],
    } as any;

    sanitizeContentCtas(pages, business, warnings);

    expect(business.primaryCta.url).toBe("/contact");
    expect(pages.home.hero.ctaUrl).toBe("/contact");
    expect(pages.programs[0].hero.ctaUrl).toBe("/contact");
    expect(warnings.length).toBeGreaterThanOrEqual(3);
  });

  test("preserves valid internal program-page CTAs", () => {
    const warnings: string[] = [];
    const business = {
      name: "KSA",
      tagline: "Train hard.",
      address: { street: "", city: "Torrance", state: "CA", zip: "90505" },
      phone: "",
      email: "",
      hours: [],
      primaryCta: { label: "Free tour", url: "/contact" },
      geo: { city: "Torrance", state: "California", stateAbbr: "CA" },
    } as any;
    const pages = {
      home: { hero: { headline: "", ctaUrl: "/programs/group-strength" }, valueProps: [], programsHeadline: "", featuredPrograms: [], features: [], communityHeadline: "", communityProps: [], trustHeadline: "", howItWorks: [], howItWorksHeadline: "", testimonials: [], faq: [] },
      programs: [{ slug: "group-strength", name: "Group Strength", shortDescription: "", coverImageUrl: "", hero: { headline: "", ctaUrl: "/contact" }, whatIsIt: { headline: "", body: "" }, whatMakesUsDifferent: [], whatToExpect: { headline: "", steps: [] }, whoIsItFor: [], gettingStarted: [], testimonials: [], faq: [] }],
      about: { hero: { headline: "" }, gymStory: "", team: [] },
      pricing: { hero: { headline: "" } },
      contact: { hero: { headline: "" } },
      schedule: { hero: { headline: "" } },
      blog: { heroHeadline: "", posts: [] },
      legal: [],
    } as any;

    sanitizeContentCtas(pages, business, warnings);

    expect(warnings).toHaveLength(0);
    expect(pages.home.hero.ctaUrl).toBe("/programs/group-strength");
    expect(pages.programs[0].hero.ctaUrl).toBe("/contact");
  });
});

describe("extractPages", () => {
  test("maps home hero from hero section", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      {
        slug: "",
        isHomePage: true,
        title: "Home",
        heroImageUrl: "https://cdn.example.com/hero.jpg",
        sections: [{
          id: "s1", tag: "hero", intent: "hero", evidenceId: "e1",
          content: {
            heading: "Train with Purpose",
            body: "Join KSA today.",
            cta: { label: "Join Now", href: "/contact" },
          },
        }],
      },
    ]);
    const biz = { name: "KSA", primaryCta: { label: "Join Now", url: "/contact" } } as any;
    const pages = extractPages(h, biz, warnings);
    expect(pages.home.hero.headline).toBe("Train with Purpose");
    expect(pages.home.hero.subheading).toBe("Join KSA today.");
    expect(pages.home.hero.ctaLabel).toBe("Join Now");
    expect(pages.home.hero.backgroundImageUrl).toBe("https://cdn.example.com/hero.jpg");
  });

  test("featuredPrograms lists program page slugs in home content", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home", sections: [] },
      { slug: "crossfit", title: "CrossFit", sections: [] },
      { slug: "bootcamp", title: "Bootcamp", sections: [] },
    ]);
    const pages = extractPages(h, { name: "KSA" } as any, warnings);
    expect(pages.home.featuredPrograms).toEqual(["crossfit", "bootcamp"]);
  });

  test("features default programs on homepage when no program pages exist", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home", sections: [] },
    ]);
    const pages = extractPages(h, { name: "KSA" } as any, warnings);
    expect(pages.home.featuredPrograms.length).toBeGreaterThan(0);
    expect(pages.programs.length).toBe(pages.home.featuredPrograms.length);
    expect(pages.home.featuredPrograms).toEqual(pages.programs.map((p) => p.slug));
    expect(warnings.some((w) => w.includes("default program set"))).toBe(true);
  });

  test("extracts programsHeadline from contract program-cards-sticky section", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home", sections: [] },
      { slug: "crossfit", title: "CrossFit", sections: [] },
    ]);
    const contract = {
      siteUuid: "test",
      sourceSegmentAt: new Date().toISOString(),
      pages: [{
        path: "/",
        slug: "index",
        isHomePage: true,
        sections: [{
          id: "programs",
          pagePath: "/",
          tag: "feature-grid",
          sourceConfidence: 0.9,
          boundingBox: { x: 0, y: 0, width: 100, height: 100 },
          layout: {
            archetype: "program-cards-sticky",
            background: {},
            spacing: { top: "0px", bottom: "0px" },
            separator: "none",
          },
          typography: {
            headline: { text: "Every body is unique. Find something that works for YOU", align: "left" },
          },
          interactions: { accordion: false, scrollSnap: false, stickyPanel: true, hoverEffects: false },
          items: [],
          media: { imageUrls: [], videoUrls: [] },
        }],
      }],
    } as any;
    const pages = extractPages(h, { name: "KSA" } as any, warnings, contract);
    expect(pages.home.programsHeadline).toBe("Every body is unique. Find something that works for YOU");
  });

  test("produces one ProgramContent per program page", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home", sections: [] },
      {
        slug: "crossfit", title: "CrossFit",
        heroImageUrl: "https://cdn.example.com/cf.jpg",
        sections: [{
          id: "s1", tag: "hero", intent: "hero", evidenceId: "e1",
          content: { heading: "CrossFit in Torrance" },
        }],
      },
    ]);
    const pages = extractPages(h, { name: "KSA" } as any, warnings);
    expect(pages.programs).toHaveLength(1);
    expect(pages.programs[0].slug).toBe("crossfit");
    expect(pages.programs[0].hero.headline).toBe("CrossFit in Torrance");
    expect(pages.programs[0].coverImageUrl).toBe("https://cdn.example.com/cf.jpg");
  });

  test("uses hierarchy hero when distinct about/pricing/contact/schedule pages exist", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home", sections: [] },
      {
        slug: "about",
        title: "Our Story",
        sections: [{
          id: "s1", tag: "hero", intent: "hero", evidenceId: "e1",
          content: { heading: "Built in Torrance" },
        }],
      },
      {
        slug: "pricing",
        title: "Memberships",
        sections: [{
          id: "s2", tag: "hero", intent: "hero", evidenceId: "e2",
          content: { heading: "Simple rates" },
        }],
      },
    ]);
    const biz = { name: "KSA", primaryCta: { label: "Join", url: "/contact" }, geo: { city: "Torrance", state: "California", stateAbbr: "CA" } };
    const pages = extractPages(h, biz as any, warnings);
    expect(pages.about.hero.headline).toBe("Built in Torrance");
    expect(pages.pricing.hero.headline).toBe("Simple rates");
  });

  test("falls back to contextual hero copy when hierarchy lacks distinct pages", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      { slug: "", isHomePage: true, title: "Home", sections: [] },
    ]);
    const biz = { name: "KSA", primaryCta: { label: "Join", url: "/contact" }, geo: { city: "Torrance", state: "California", stateAbbr: "CA" } };
    const pages = extractPages(h, biz as any, warnings);
    expect(pages.about.hero.headline).toBe("About KSA in Torrance, CA");
    expect(pages.pricing.hero.headline).toBe("Memberships and rates in Torrance, CA");
    expect(pages.contact.hero.headline).toBe("Visit us in Torrance, CA");
    expect(pages.schedule.hero.headline).toBe("Class schedule in Torrance, CA");
    expect(pages.localGuide?.hero.headline).toBe("Your fitness guide to Torrance, CA");
    expect(pages.about.hero.backgroundImageUrl).toBe("__NO_IMAGE__");
  });

  test("maps iframe widget sections to the matching generated page by variant", () => {
    const warnings: string[] = [];
    const h = makeHierarchy([
      {
        slug: "",
        isHomePage: true,
        title: "Home",
        sections: [
          { id: "reviews", tag: "iframe", intent: "social proof", evidenceId: "e1", content: { widgetUrl: "https://widgets.trustpilot.com/reviews/123", heading: "Member reviews" } },
          { id: "schedule", tag: "iframe", intent: "booking", evidenceId: "e2", content: { widgetUrl: "https://app.acuityscheduling.com/schedule.php?owner=123", heading: "Book a class" } },
          { id: "map", tag: "iframe", intent: "location", evidenceId: "e3", content: { widgetUrl: "https://www.google.com/maps/embed?pb=abc", heading: "Find us" } },
          { id: "unsafe", tag: "iframe", intent: "ignored", evidenceId: "e4", content: { widgetUrl: "javascript:alert(1)" } },
        ],
      },
    ]);
    const pages = extractPages(h, { name: "KSA" } as any, warnings);

    expect(pages.home.iframes).toHaveLength(1);
    expect(pages.home.iframes?.[0].src).toBe("https://widgets.trustpilot.com/reviews/123");
    expect(pages.home.iframes?.[0].variant).toBe("default");

    expect(pages.schedule.iframes).toHaveLength(1);
    expect(pages.schedule.iframes?.[0].variant).toBe("schedule");

    expect(pages.contact.iframes).toHaveLength(1);
    expect(pages.contact.iframes?.[0].variant).toBe("map");

    expect(warnings.some((w) => w.includes("unsafe"))).toBe(false);
  });
});
