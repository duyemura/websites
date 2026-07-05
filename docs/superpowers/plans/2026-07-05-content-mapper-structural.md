# Structural Content Mapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic mapper that reads pipeline docs from the DB and produces a valid `GymSiteContent` (`gym.json`), wired into `deployTemplate` so the mirror → Managed upgrade works automatically.

**Architecture:** Three pure extraction functions (`extractBrand`, `extractBusiness`, `extractNavigation`+`extractPages`) operate on already-parsed doc JSON and a warnings accumulator. `buildGymJson` loads the docs from DB and orchestrates them. `deployTemplate` calls `buildGymJson` when no `content` override is supplied, keeping the eval script working unchanged.

**Tech Stack:** TypeScript · Kysely · Vitest (unit tests with fixture objects, no DB required)

---

## File map

| File | Action |
|---|---|
| `apps/api/src/services/template/content-mapper.ts` | **Create** — all extraction logic + `buildGymJson` |
| `apps/api/src/services/template/__tests__/content-mapper.test.ts` | **Create** — unit tests with fixture objects |
| `apps/api/src/services/template/deploy-template.ts` | **Modify** — make `content` optional, call mapper when absent |
| `apps/api/scripts/eval/run-template-deploy.ts` | **Modify** — make `--content` optional |

---

## Task 1: Pure extraction functions + unit tests

**Files:**
- Create: `apps/api/src/services/template/content-mapper.ts`
- Test: `apps/api/src/services/template/__tests__/content-mapper.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/api/src/services/template/__tests__/content-mapper.test.ts
import { describe, test, expect } from "vitest";
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

const BUSINESS_MD = `
# KS Athletic Club

Located at 1234 Fitness Ave, Torrance, CA 90503.
Call us: (310) 555-0123
Email: info@ksathleticclub.com

Hours:
Mon-Fri: 5:00am - 10:00pm
Sat-Sun: 7:00am - 6:00pm
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
    expect(brand.accentColor).toBe("#333");
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
    expect(brand.primaryColor).toBe("#1a1a1a");
    expect(brand.headingFont).toBe("Inter");
    expect(brand.bodyFont).toBe("Inter");
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

  test("falls back gracefully when markdown has no address", () => {
    const warnings: string[] = [];
    const biz = extractBusiness("No address here.", DS, warnings);
    expect(biz.address.street).toBe("");
    expect(biz.address.city).toBe("");
    expect(warnings.some((w) => w.includes("address"))).toBe(true);
  });

  test("uses default CTA when design-system has none", () => {
    const warnings: string[] = [];
    const noCtaDS: DesignSystemV2 = { ...DS, reference: { homePagePrimaryCta: null } };
    const biz = extractBusiness("", noCtaDS, warnings);
    expect(biz.primaryCta).toEqual({ label: "Get started", url: "/" });
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
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/api && pnpm test --no-file-parallelism src/services/template/__tests__/content-mapper.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `content-mapper.ts` with all extraction functions**

```typescript
// apps/api/src/services/template/content-mapper.ts
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type { SiteHierarchy, HierarchyPage } from "../../types/site-hierarchy";
import type {
  GymSiteContent, SiteMeta, BrandTokens, BusinessInfo,
  Navigation, NavItem, FooterGroup, PageContent, HomeContent,
  ProgramContent, AboutContent, PricingContent, ContactContent,
  ScheduleContent, BlogContent, LegalPage, HeroContent,
} from "../../../../renderer/src/types/gym-content";

// ── State abbr lookup ────────────────────────────────────────────────────────

const STATE_ABBRS: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fallback<T>(value: T | undefined | null | "", def: T, warnings: string[], field: string): T {
  if (value === undefined || value === null || value === "") {
    warnings.push(`${field} not found — using default`);
    return def;
  }
  return value;
}

// ── Brand ────────────────────────────────────────────────────────────────────

export function extractBrand(ds: DesignSystemV2, warnings: string[]): BrandTokens {
  const c = ds.global.tokens.colors;
  const f = ds.global.tokens.fonts;
  const logo = ds.brand.logo;
  return {
    primaryColor: fallback(c.primary, "#1a1a1a", warnings, "primaryColor"),
    secondaryColor: fallback(c.background, "#ffffff", warnings, "secondaryColor"),
    accentColor: fallback(c.muted, "#666666", warnings, "accentColor"),
    headingFont: fallback(f.heading, "Inter", warnings, "headingFont"),
    bodyFont: fallback(f.body, "Inter", warnings, "bodyFont"),
    logoUrl: logo.type === "image" ? (logo.value || fallback("", "", warnings, "logoUrl")) : "",
    logoAlt: logo.alt || ds.business.name || "",
  };
}

// ── Business ─────────────────────────────────────────────────────────────────

export function extractBusiness(markdown: string, ds: DesignSystemV2, warnings: string[]): BusinessInfo {
  const name = fallback(ds.business.name || ds.siteMetadata.businessName, "", warnings, "business.name");
  const tagline = ds.business.tagline ?? "";

  const phone = markdown.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/)?.[0] ?? "";
  if (!phone) warnings.push("phone not found — using empty string");

  const email = markdown.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0];

  // Street address: number + name + type, followed by city, state abbr, zip
  const addrMatch = markdown.match(
    /(\d+\s+[\w\s]+(?:St(?:reet)?|Ave(?:nue)?|Blvd|Dr(?:ive)?|Rd|Way|Ln|Lane|Court|Ct|Pl(?:ace)?|Circle|Cir)[\w\s]*),?\s*([\w\s]+),\s*([A-Z]{2})\s+(\d{5})/i,
  );
  const street = addrMatch?.[1]?.trim() ?? fallback("", "", warnings, "address.street");
  const city = addrMatch?.[2]?.trim() ?? fallback("", "", warnings, "address.city");
  const stateAbbr = addrMatch?.[3]?.toUpperCase() ?? fallback("", "", warnings, "address.state");
  const zip = addrMatch?.[4] ?? fallback("", "", warnings, "address.zip");

  const primaryCta = ds.reference.homePagePrimaryCta
    ? { label: ds.reference.homePagePrimaryCta.label, url: ds.reference.homePagePrimaryCta.href }
    : { label: "Get started", url: "/" };

  return {
    name,
    tagline,
    address: { street, city, state: stateAbbr, zip },
    phone,
    email: email || undefined,
    hours: [],
    primaryCta,
    geo: { city, state: STATE_ABBRS[stateAbbr] ?? stateAbbr, stateAbbr },
  };
}

// ── Page classification ───────────────────────────────────────────────────────

export function classifyPage(page: HierarchyPage): "home" | "about" | "contact" | "pricing" | "schedule" | "blog" | "legal" | "program" {
  if (page.isHomePage) return "home";
  const s = page.slug.toLowerCase();
  if (/about/.test(s)) return "about";
  if (/contact/.test(s)) return "contact";
  if (/pricing|membership|join/.test(s)) return "pricing";
  if (/schedule|classes/.test(s)) return "schedule";
  if (page.pageType === "blog" || /\bblog\b/.test(s)) return "blog";
  if (/privacy|terms|legal/.test(s)) return "legal";
  return "program";
}

// ── Navigation ───────────────────────────────────────────────────────────────

export function extractNavigation(hierarchy: SiteHierarchy, warnings: string[]): Navigation {
  void warnings;
  const pages = hierarchy.pages;

  const isLegal = (p: HierarchyPage) => classifyPage(p) === "legal";
  const isBlog = (p: HierarchyPage) => classifyPage(p) === "blog";

  const header: NavItem[] = pages
    .filter((p) => !isLegal(p) && !isBlog(p))
    .map((p) => ({ label: p.title, href: p.isHomePage ? "/" : `/${p.slug}` }));

  const footerGroups: FooterGroup[] = [
    {
      label: "Company",
      links: pages
        .filter((p) => ["about", "contact"].includes(classifyPage(p)))
        .map((p) => ({ label: p.title, href: `/${p.slug}` })),
    },
    {
      label: "Programs",
      links: pages
        .filter((p) => classifyPage(p) === "program")
        .map((p) => ({ label: p.title, href: `/${p.slug}` })),
    },
    {
      label: "Legal",
      links: pages
        .filter(isLegal)
        .map((p) => ({ label: p.title, href: `/${p.slug}` })),
    },
  ].filter((g) => g.links.length > 0);

  return { header, footer: footerGroups };
}

// ── Pages ────────────────────────────────────────────────────────────────────

function heroFromPage(page: HierarchyPage): HeroContent {
  const section = page.sections.find((s) => s.tag === "hero");
  return {
    headline: section?.content.heading || page.title,
    subheading: section?.content.body || undefined,
    ctaLabel: section?.content.cta?.label || undefined,
    ctaUrl: section?.content.cta?.href || undefined,
    backgroundImageUrl: page.heroImageUrl || undefined,
  };
}

export function extractPages(
  hierarchy: SiteHierarchy,
  business: Pick<BusinessInfo, "name">,
  warnings: string[],
): PageContent {
  const pages = hierarchy.pages;
  const byClass = (cls: ReturnType<typeof classifyPage>) => pages.filter((p) => classifyPage(p) === cls);

  const homePage = pages.find((p) => p.isHomePage) ?? pages[0];
  if (!homePage) warnings.push("no home page found in hierarchy — using empty home");

  const programPages = byClass("program");
  const featuredPrograms = programPages.slice(0, 6).map((p) => p.slug);

  const home: HomeContent = {
    hero: homePage ? heroFromPage(homePage) : { headline: business.name },
    valueProps: [],
    programsHeadline: "Our Programs",
    featuredPrograms,
    features: [],
    communityHeadline: "",
    communityProps: [],
    trustHeadline: "",
    howItWorks: [],
    howItWorksHeadline: "",
    testimonials: [],
    faq: [],
  };

  const programs: ProgramContent[] = programPages.map((p) => ({
    slug: p.slug,
    name: p.title,
    shortDescription: (p.sections.find((s) => s.tag === "hero")?.content.body ?? "").slice(0, 160),
    coverImageUrl: p.heroImageUrl ?? "",
    hero: heroFromPage(p),
    whatIsIt: { headline: "", body: "" },
    whatMakesUsDifferent: [],
    whatToExpect: { headline: "", steps: [] },
    whoIsItFor: [],
    gettingStarted: [],
    testimonials: [],
    faq: [],
  }));

  const aboutPage = byClass("about")[0];
  const about: AboutContent = {
    hero: aboutPage ? heroFromPage(aboutPage) : { headline: "About Us" },
    gymStory: "",
    team: [],
  };

  const pricingPage = byClass("pricing")[0];
  const pricing: PricingContent = {
    hero: pricingPage ? heroFromPage(pricingPage) : { headline: "Pricing" },
  };

  const contactPage = byClass("contact")[0];
  const contact: ContactContent = {
    hero: contactPage ? heroFromPage(contactPage) : { headline: "Contact" },
  };

  const schedulePage = byClass("schedule")[0];
  const schedule: ScheduleContent = {
    hero: schedulePage ? heroFromPage(schedulePage) : { headline: "Schedule" },
  };

  const blog: BlogContent = { heroHeadline: "Our Blog", posts: [] };

  const legal: LegalPage[] = byClass("legal").map((p) => ({
    slug: p.slug,
    title: p.title,
    blocks: [],
  }));

  return { home, programs, about, pricing, contact, schedule, blog, legal };
}

// ── Doc loader ───────────────────────────────────────────────────────────────

async function loadDoc(db: Kysely<DB>, siteUuid: string, key: string) {
  return db
    .selectFrom("docs")
    .select(["content", "contentJson"])
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", key)
    .where("status", "=", "active")
    .orderBy("updatedAt", "desc")
    .executeTakeFirst();
}

// ── Main entry point ─────────────────────────────────────────────────────────

export interface MapperResult {
  content: GymSiteContent;
  warnings: string[];
}

export interface MapperConfig {
  apiBaseUrl: string;
  siteUrl: string;
}

export async function buildGymJson(
  db: Kysely<DB>,
  siteUuid: string,
  config: MapperConfig,
): Promise<MapperResult> {
  const warnings: string[] = [];

  const [dsDoc, bizDoc, hierDoc] = await Promise.all([
    loadDoc(db, siteUuid, "design-system"),
    loadDoc(db, siteUuid, "business-info"),
    loadDoc(db, siteUuid, "site-hierarchy"),
  ]);

  if (!dsDoc?.contentJson) warnings.push("design-system doc missing — using all brand defaults");
  if (!hierDoc?.contentJson) warnings.push("site-hierarchy doc missing — using minimal page structure");

  const ds = (dsDoc?.contentJson ?? {
    version: "2",
    siteMetadata: { framework: "astro", mode: "replication", generatedAt: "" },
    global: {
      tokens: {
        colors: { primary: "", primaryForeground: "", background: "", foreground: "", muted: "", mutedForeground: "", border: "" },
        fonts: { heading: "", body: "" },
        radius: "",
      },
      shell: {},
      rules: {},
    },
    business: {},
    brand: { logo: { type: "text", value: "" }, headingStyle: { uppercase: false, bold: false } },
    reference: {},
  }) as DesignSystemV2;

  const hierarchy = (hierDoc?.contentJson ?? {
    version: "1",
    siteMetadata: { framework: "astro", mode: "replication", generatedAt: "" },
    pages: [],
    buildPlan: { nextPage: "", pageStatus: {}, buildOrder: [] },
  }) as SiteHierarchy;

  const brand = extractBrand(ds, warnings);
  const business = extractBusiness(bizDoc?.content ?? "", ds, warnings);
  const navigation = extractNavigation(hierarchy, warnings);
  const pages = extractPages(hierarchy, business, warnings);

  const meta: SiteMeta = {
    siteId: siteUuid,
    apiBaseUrl: config.apiBaseUrl,
    siteUrl: config.siteUrl,
    defaultTitle: business.name ? `${business.name} | ${business.geo.city} Gym` : "Gym",
    defaultDescription: business.tagline,
    preview: false,
  };

  return {
    content: { meta, business, brand, navigation, pages },
    warnings,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/api && pnpm test --no-file-parallelism src/services/template/__tests__/content-mapper.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no TypeScript errors. If the `gym-content` import path is wrong, adjust relative path — the renderer is at `apps/renderer/src/types/gym-content.ts` so from `apps/api/src/services/template/` the path is `../../../../renderer/src/types/gym-content`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/template/content-mapper.ts apps/api/src/services/template/__tests__/content-mapper.test.ts
git commit -m "feat(mapper): structural content mapper — brand, business, nav, pages extraction"
```

---

## Task 2: Wire `buildGymJson` into `deploy-template.ts`

**Files:**
- Modify: `apps/api/src/services/template/deploy-template.ts`
- Modify: `apps/api/scripts/eval/run-template-deploy.ts`

`content` becomes optional in `DeployTemplateInput`. When absent, `buildGymJson` is called internally. The eval script keeps working with `--content` for fixture-based testing.

- [ ] **Step 1: Read `deploy-template.ts`**

Read the full file to understand `DeployTemplateInput` and where `content` is used. The key lines are:

```typescript
export interface DeployTemplateInput {
  // ...
  content: unknown;         ← make optional
  // ...
}
```

And inside `deployTemplate`:
```typescript
await fs.writeFile(path.join(rendererDir, "src/content/gym.json"), JSON.stringify(content, null, 2));
```

- [ ] **Step 2: Update `DeployTemplateInput` and `deployTemplate`**

In `deploy-template.ts`:

Change `content: unknown` to `content?: unknown` in the interface.

Add `apiBaseUrl?: string` and `siteUrl?: string` to the interface (used when content is absent):

```typescript
export interface DeployTemplateInput {
  db: Kysely<DB>;
  s3Client: S3Client;
  bucket: string;
  siteUuid: string;
  workspaceUuid: string;
  /** Pre-built GymSiteContent. If omitted, the structural content mapper runs automatically. */
  content?: unknown;
  /** Required when content is omitted — the API's public base URL. */
  apiBaseUrl?: string;
  /** Required when content is omitted — the site's canonical URL. */
  siteUrl?: string;
  rendererDir: string;
  label?: string;
  log: { info: (o: object, m: string) => void; warn?: (o: object, m: string) => void };
}
```

Inside `deployTemplate`, before the `fs.writeFile` call, add the mapper invocation:

```typescript
  let gymJson = input.content;
  if (!gymJson) {
    const apiBaseUrl = input.apiBaseUrl ?? "";
    const siteUrl = input.siteUrl ?? "";
    const { buildGymJson } = await import("./content-mapper.js");
    const { content: mapped, warnings } = await buildGymJson(db, siteUuid, { apiBaseUrl, siteUrl });
    if (warnings.length > 0) {
      (log.warn ?? log.info)({ siteUuid, warnings }, "content mapper used defaults");
    }
    gymJson = mapped;
  }

  await fs.writeFile(path.join(rendererDir, "src/content/gym.json"), JSON.stringify(gymJson, null, 2));
```

Replace the original `JSON.stringify(content, null, 2)` line with `JSON.stringify(gymJson, null, 2)`.

- [ ] **Step 3: Update `run-template-deploy.ts` to make `--content` optional**

Read `apps/api/scripts/eval/run-template-deploy.ts`. Change:

```typescript
  if (!siteUuid || !contentPath) {
    console.error("Usage: --site <uuid> --content <path-to-gym.json> [--publish]");
    process.exit(1);
  }

  const site = await db.selectFrom("sites").select(["uuid", "workspaceUuid"]).where("uuid", "=", siteUuid).executeTakeFirstOrThrow();
  const content = JSON.parse(readFileSync(contentPath, "utf8"));
```

To:

```typescript
  if (!siteUuid) {
    console.error("Usage: --site <uuid> [--content <path-to-gym.json>] [--publish]");
    process.exit(1);
  }

  const site = await db.selectFrom("sites").select(["uuid", "workspaceUuid", "customDomain"]).where("uuid", "=", siteUuid).executeTakeFirstOrThrow();
  const content = contentPath ? JSON.parse(readFileSync(contentPath, "utf8")) : undefined;
```

And update the `deployTemplate` call to pass `apiBaseUrl` and `siteUrl` when no content is provided:

```typescript
  const result = await deployTemplate({
    db, s3Client, bucket,
    siteUuid: site.uuid, workspaceUuid: site.workspaceUuid,
    content,
    apiBaseUrl: config.CDN_BASE_URL,
    siteUrl: site.customDomain
      ? `https://${site.customDomain}`
      : `${config.CDN_BASE_URL}/sites/${site.uuid}/current`,
    rendererDir,
    log: { info: (o, m) => console.log(m, o) },
  });
```

- [ ] **Step 4: Build**

```bash
cd apps/api && pnpm build 2>&1 | tail -5
```

Expected: no TypeScript errors.

- [ ] **Step 5: Smoke test with fixture (existing behavior unchanged)**

```bash
cd apps/api && npx tsx scripts/eval/run-template-deploy.ts \
  --site ab867633-9d48-4258-b752-07214d6314b7 \
  --content ../renderer/src/content/gym.fixture.json
```

Expected: same output as before — version number, route count, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/template/deploy-template.ts apps/api/scripts/eval/run-template-deploy.ts
git commit -m "feat(mapper): wire buildGymJson into deployTemplate, content param now optional"
```

---

## Running all tests

```bash
cd apps/api && pnpm test --no-file-parallelism
```

Expected: all existing tests still pass, new content-mapper tests pass.
