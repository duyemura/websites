import { describe, test, expect } from "vitest";
import { DEFAULT_TEMPLATE_TOKENS, DEFAULT_BUSINESS_PLACEHOLDER } from "@ploy-gyms/shared-types/template-baseline";
import {
  extractBrand,
  extractBusiness,
  extractNavigation,
  extractPages,
  classifyPage,
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
    expect(brand.primaryColor).toBe("#e63946");
    expect(brand.secondaryColor).toBe("#0d0d0d");
    expect(brand.accentColor).toBe("#f1f1f1");
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
    expect(brand.primaryColor).toBe(DEFAULT_TEMPLATE_TOKENS.colors.primary);
    expect(brand.headingFont).toBe(DEFAULT_TEMPLATE_TOKENS.fonts.heading);
    expect(brand.bodyFont).toBe(DEFAULT_TEMPLATE_TOKENS.fonts.body);
    expect(brand.logoUrl).toBe("");
    expect(warnings.some((w) => w.includes("primaryColor"))).toBe(true);
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
    const pages = extractPages(h, { name: "KSA" } as any, warnings);
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
});
