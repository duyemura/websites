import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type { SiteHierarchy, HierarchyPage } from "../../types/site-hierarchy";
import {
  DEFAULT_TEMPLATE_TOKENS,
  DEFAULT_BUSINESS_PLACEHOLDER,
  DEFAULT_PROGRAMS,
  DEFAULT_BUSINESS_NAME,
  DEFAULT_CITY,
  NO_IMAGE,
  placeholderImage,
} from "@ploy-gyms/shared-types/template-baseline";

import type {
  GymSiteContent, SiteMeta, BrandTokens, BusinessInfo,
  Navigation, NavItem, FooterGroup, PageContent, HomeContent,
  ProgramContent, AboutContent, PricingContent, ContactContent,
  ScheduleContent, BlogContent, LegalPage, HeroContent, Feature,
} from "@ploy-gyms/shared-types";
import { loadArtifact } from "../../utils/pipeline/artifact-store";
import type { ContractArtifact, SectionContract } from "../../types/section-contract";

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

// ── CTA URL sanitizer ───────────────────────────────────────────────────────

const TOP_LEVEL_TEMPLATE_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/pricing",
  "/schedule",
  "/blog",
  "/local-guide",
  "/programs",
]);

export function sanitizeInternalUrl(
  href: string | undefined | null,
  allowedPaths: Set<string>,
  fallback: string,
  warnings: string[],
  context: string,
): string {
  if (!href) return fallback;
  // Preserve external URLs, anchors, mailto, tel.
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) return href;
  const normalized = href.toLowerCase().replace(/\/+$/, "") || "/";
  if (allowedPaths.has(normalized)) return href;
  warnings.push(`${context} CTA href ${href} points to a page that will not be generated — using ${fallback}`);
  return fallback;
}

/**
 * Ensure every internal CTA URL points to a page the Astro template will actually render.
 * External URLs, anchors, mailto, and tel links are preserved.
 */
export function sanitizeContentCtas(
  pages: PageContent,
  business: BusinessInfo,
  warnings: string[],
): void {
  const allowedPaths = new Set([
    ...TOP_LEVEL_TEMPLATE_PATHS,
    ...pages.programs.map((p) => `/programs/${p.slug}`),
    ...pages.legal.map((p) => `/legal/${p.slug}`),
  ]);

  business.primaryCta.url = sanitizeInternalUrl(
    business.primaryCta?.url,
    allowedPaths,
    "/contact",
    warnings,
    "business.primaryCta",
  );

  const sanitizeHero = (hero: HeroContent | undefined, ctx: string) => {
    if (!hero) return;
    hero.ctaUrl = sanitizeInternalUrl(
      hero.ctaUrl,
      allowedPaths,
      business.primaryCta.url,
      warnings,
      `${ctx}.hero`,
    );
  };

  sanitizeHero(pages.home.hero, "home");
  for (const p of pages.programs) sanitizeHero(p.hero, `programs.${p.slug}`);
  sanitizeHero(pages.about.hero, "about");
  sanitizeHero(pages.pricing.hero, "pricing");
  sanitizeHero(pages.contact.hero, "contact");
  sanitizeHero(pages.schedule.hero, "schedule");

  if (pages.localGuide?.hero) {
    sanitizeHero(pages.localGuide.hero, "localGuide");
  }
}

// ── Brand ────────────────────────────────────────────────────────────────────

export function extractBrand(ds: DesignSystemV2, warnings: string[]): BrandTokens {
  const c = ds.global.tokens.colors;
  const f = ds.global.tokens.fonts;
  const logo = ds.brand.logo;
  const baseline = DEFAULT_TEMPLATE_TOKENS;
  return {
    primaryColor: fallback(c.primary, baseline.colors.primary, warnings, "primaryColor"),
    secondaryColor: fallback(c.background, baseline.colors.foreground, warnings, "secondaryColor"),
    accentColor: fallback(c.foreground, baseline.colors.mutedForeground, warnings, "accentColor"),
    headingFont: fallback(f.heading, baseline.fonts.heading, warnings, "headingFont"),
    bodyFont: fallback(f.body, baseline.fonts.body, warnings, "bodyFont"),
    logoUrl: logo.type === "image" ? (logo.value || fallback("", "", warnings, "logoUrl")) : "",
    logoAlt: logo.alt || ds.business.name || DEFAULT_BUSINESS_NAME,
  };
}

// ── Business ─────────────────────────────────────────────────────────────────

export function extractBusiness(markdown: string, ds: DesignSystemV2, warnings: string[]): BusinessInfo {
  const baseline = DEFAULT_BUSINESS_PLACEHOLDER;
  // Name extraction priority:
  // 1. design-system structured field
  // 2. **Business Name**: label in markdown
  // 3. "Welcome to [Name]" pattern in markdown description
  // 4. H1 heading in markdown (strip SEO suffix after " | ")
  // 5. Markdown title line (strip SEO suffix after " | ")
  // 6. Baseline default
  const labelLine = (label: string): string =>
    markdown.match(new RegExp(`(?:-\\s+)?\\*\\*${label}\\*\\*:\\s*(.+)`, "i"))?.[1]?.trim() ?? "";

  const nameFromLabel = labelLine("Business Name");
  const nameFromWelcome = markdown.match(/Welcome to ([^,.\n]+)[,.\n]/)?.[1]?.trim() ?? "";
  const nameFromH1 = markdown.match(/^-\s*\(h1\)\s*(.+)$/m)?.[1]?.trim().split(" | ")[0] ?? "";
  const nameFromTitle = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().split(" | ")[0] ?? "";

  const name = fallback(
    ds.business?.name || ds.siteMetadata?.businessName ||
    nameFromLabel || nameFromWelcome || nameFromH1 || nameFromTitle,
    baseline.name, warnings, "business.name"
  );
  const tagline = ds.business?.tagline ?? baseline.tagline;

  // Label-based extraction — looks for labeled lines like **Phone**: (555) 123-4567

  const phone = labelLine("Phone") || fallback("", baseline.phone, warnings, "phone");
  const email = labelLine("Email") || baseline.email;

  // Address is the whole labeled value — apply regex to this single clean string
  const addrStr = labelLine("Address");
  // Pass 1: strict match with 2-letter state abbreviation
  const addrMatch = addrStr.match(
    /^(\d+\s+[\w\s]+?(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Way|Ln|Lane|Court|Ct|Pl(?:ace)?|Circle|Cir|Pkwy|Parkway|Hwy|Highway|Terr(?:ace)?|Trl|Trail)\.?),?\s*(?:Suite?\s*\d+\s*,\s*)?([\w\s]+?),\s*([A-Z]{2})\s+(\d{5})/i,
  );
  // Pass 2: loose match with 2-letter abbreviation (no street type required)
  const looseMatch = !addrMatch
    ? addrStr.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\s+(\d{5})/i)
    : null;
  // Pass 3: GMB format — full state name: "street, city, StateName, zip"
  const stateNameToAbbr = Object.fromEntries(Object.entries(STATE_ABBRS).map(([k, v]) => [v.toLowerCase(), k]));
  const fullStateMatch = !addrMatch && !looseMatch
    ? addrStr.match(/^(.+?),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*(\d{5})/i)
    : null;
  const fullStateAbbr = fullStateMatch
    ? (stateNameToAbbr[(fullStateMatch[3] ?? "").toLowerCase()] ?? (fullStateMatch[3] ?? "").slice(0, 2).toUpperCase())
    : undefined;
  const street = addrMatch?.[1]?.trim() ?? fullStateMatch?.[1]?.trim() ?? fallback("", baseline.address.street, warnings, "address.street");
  const city = addrMatch?.[2]?.trim() ?? looseMatch?.[1]?.trim() ?? fullStateMatch?.[2]?.trim() ?? fallback("", baseline.address.city, warnings, "address.city");
  const stateAbbr = (addrMatch?.[3] ?? looseMatch?.[2] ?? fullStateAbbr)?.toUpperCase() ?? fallback("", baseline.address.state, warnings, "address.state");
  const zip = addrMatch?.[4] ?? looseMatch?.[3] ?? fullStateMatch?.[4] ?? fallback("", baseline.address.zip, warnings, "address.zip");

  // Social links from labeled lines
  const socialPlatforms = ["facebook", "instagram", "twitter", "tiktok", "youtube"] as const;
  const social: Partial<Record<typeof socialPlatforms[number], string>> = {};
  for (const platform of socialPlatforms) {
    const url = labelLine(platform);
    if (url) social[platform] = url;
  }

  const primaryCta = ds.reference.homePagePrimaryCta
    ? { label: ds.reference.homePagePrimaryCta.label, url: ds.reference.homePagePrimaryCta.href }
    : baseline.primaryCta;

  return {
    name,
    tagline,
    address: { street, city, state: stateAbbr, zip },
    phone,
    email,
    hours: [],
    primaryCta,
    trialCta: baseline.trialCta,
    geo: { city, state: STATE_ABBRS[stateAbbr] ?? stateAbbr, stateAbbr },
    serviceArea: baseline.serviceArea,
    aggregateRating: baseline.aggregateRating,
    social: Object.keys(social).length > 0 ? social as BusinessInfo["social"] : baseline.social,
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

function heroFromPage(page: HierarchyPage, contractHero?: SectionContract, business?: Pick<BusinessInfo, "primaryCta">): HeroContent {
  const section = page.sections.find((s) => s.tag === "hero");
  return {
    headline: section?.content.heading || page.title,
    subheading: section?.content.body || undefined,
    ctaLabel: section?.content.cta?.label || business?.primaryCta?.label || undefined,
    ctaUrl: section?.content.cta?.href || business?.primaryCta?.url || undefined,
    backgroundImageUrl:
      contractHero?.media?.imageUrls?.[0] ??
      contractHero?.layout?.background?.imageUrl ??
      page.heroImageUrl ??
      undefined,
  };
}

export function extractPages(
  hierarchy: SiteHierarchy,
  business: Pick<BusinessInfo, "name" | "primaryCta">,
  warnings: string[],
  contract: ContractArtifact | null = null,
): PageContent {
  const pages = hierarchy.pages;
  const byClass = (cls: ReturnType<typeof classifyPage>) => pages.filter((p) => classifyPage(p) === cls);

  const homePage = pages.find((p) => p.isHomePage) ?? pages[0];
  if (!homePage) warnings.push("no home page found in hierarchy — using empty home");

  const programPages = byClass("program");
  const hasProgramPages = programPages.length > 0;
  const featuredPrograms = hasProgramPages
    ? programPages.slice(0, 6).map((p) => p.slug)
    : DEFAULT_PROGRAMS.map((p) => p.slug);
  if (!hasProgramPages) {
    warnings.push("no program pages found in hierarchy — using default program set and featuring them on homepage");
  }

  const contractHomeSections = contract?.pages.find((p) => p.path === (homePage?.path ?? "/"))?.sections ?? [];
  const contractHero = contractHomeSections.find((s) => s.tag === "hero");
  const contractPrograms = contractHomeSections.find((s) => s.layout.archetype === "program-cards-sticky");
  const contractFeatureGrid = contractHomeSections.find((s) => s.layout.archetype.startsWith("feature-grid"));
  const programsHeadline = contractPrograms?.typography?.headline?.text || "Our Programs";

  const home: HomeContent = {
    hero: homePage ? heroFromPage(homePage, contractHero, business) : { headline: business.name, ctaLabel: business.primaryCta.label, ctaUrl: business.primaryCta.url, backgroundImageUrl: contractHero?.media?.imageUrls?.[0] ?? contractHero?.layout?.background?.imageUrl },
    valueProps: [],
    programsHeadline,
    featuredPrograms,
    features: contractFeatureGrid ? featureGridItems(contractFeatureGrid) : [],
    communityHeadline: "",
    communityProps: [],
    trustHeadline: "",
    howItWorks: [],
    howItWorksHeadline: "",
    testimonials: [],
    faq: [],
  };

  const defaultPrograms: ProgramContent[] = DEFAULT_PROGRAMS.map((p) => ({
    slug: p.slug,
    name: p.name,
    shortDescription: "Coach-led training for every fitness level.",
    coverImageUrl: NO_IMAGE,
    hero: {
      headline: `Try our ${p.name}`,
      subheading: "",
      ctaLabel: DEFAULT_BUSINESS_PLACEHOLDER.primaryCta.label,
      ctaUrl: DEFAULT_BUSINESS_PLACEHOLDER.primaryCta.url,
      backgroundImageUrl: NO_IMAGE,
    },
    whatIsIt: { headline: `What is ${p.name.toLowerCase()}?`, body: "" },
    whatMakesUsDifferent: [],
    whatToExpect: { headline: "What to expect", steps: [] },
    whoIsItFor: [],
    gettingStarted: [],
    testimonials: [],
    faq: [],
  }));

  const programs: ProgramContent[] = programPages.length > 0
    ? programPages.map((p) => ({
        slug: p.slug,
        name: p.title,
        shortDescription: (p.sections.find((s) => s.tag === "hero")?.content.body ?? "").slice(0, 160),
        coverImageUrl: p.heroImageUrl || placeholderImage(p.title, 800, 600),
        hero: {
          ...heroFromPage(p),
          backgroundImageUrl: p.heroImageUrl || placeholderImage(p.title, 1600, 900),
        },
        whatIsIt: { headline: "", body: "" },
        whatMakesUsDifferent: [],
        whatToExpect: { headline: "", steps: [] },
        whoIsItFor: [],
        gettingStarted: [],
        testimonials: [],
        faq: [],
      }))
    : defaultPrograms;

  const aboutPage = byClass("about")[0];
  const about: AboutContent = {
    hero: aboutPage ? heroFromPage(aboutPage) : { headline: "About Us", backgroundImageUrl: NO_IMAGE },
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

// ── Contract-aware mapping helpers ────────────────────────────────────────────

function inferImpactTheme(contract: ContractArtifact | null, _home: HomeContent): boolean {
  if (!contract) return false;
  const homeSections = contract.pages.find((p) => p.isHomePage)?.sections ?? [];
  // The impact theme is built around a bold bento feature grid. Treat any
  // feature-grid section on the homepage as a signal to use the impact layout;
  // fall back to sticky program cards if present.
  return homeSections.some((s) =>
    s.layout.archetype.startsWith("feature-grid") ||
    s.layout.archetype === "program-cards-sticky"
  );
}

function featureGridItems(section: SectionContract): Feature[] {
  return section.items.map((item) => {
    const position = typeof item.position?.row === "string"
      ? { col: item.position.col, row: Number(item.position.row) }
      : { col: item.position?.col };
    return {
      icon: item.icon ?? "none",
      label: item.title,
      position,
      background: item.background,
    };
  });
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
  workspaceUuid?: string;
}

export async function buildGymJson(
  db: Kysely<DB>,
  siteUuid: string,
  config: MapperConfig,
  workspaceUuid?: string,
): Promise<MapperResult> {
  const warnings: string[] = [];

  const [dsDoc, bizDoc, hierDoc] = await Promise.all([
    loadDoc(db, siteUuid, "design-system"),
    loadDoc(db, siteUuid, "business-info"),
    loadDoc(db, siteUuid, "site-hierarchy"),
  ]);

  let contract: ContractArtifact | null = null;
  if (config.workspaceUuid) {
    const artifact = await loadArtifact<ContractArtifact>(
      db,
      { siteUuid, workspaceUuid: config.workspaceUuid },
      "contract",
    ).catch(() => null);
    contract = artifact?.payload ?? null;
  }

  if (!dsDoc?.contentJson) warnings.push("design-system doc missing — using all brand defaults");
  if (!bizDoc?.content) warnings.push("business-info doc missing — address/phone/email will be empty");
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
  const pages = extractPages(hierarchy, business, warnings, contract);

  // ── Phase 2: merge page briefs from content artifact ──────────────────────
  const resolvedWorkspaceUuid = workspaceUuid ?? config.workspaceUuid ?? "";
  const contentArtifact = await loadArtifact(
    db,
    { siteUuid, workspaceUuid: resolvedWorkspaceUuid },
    "content" as any,
  ) as { payload: { pages: Array<{ path: string; pageType: string; contentFound?: Record<string, unknown>; data?: Record<string, unknown> }> } } | null;

  if (contentArtifact?.payload?.pages?.length) {
    const byPath = new Map(contentArtifact.payload.pages.map(p => [p.path, p]));

    // Resolve per-page content: new brief format uses contentFound, old format used data
    const cf = (p: { contentFound?: Record<string, unknown>; data?: Record<string, unknown> } | undefined): any =>
      p?.contentFound ?? p?.data ?? null;

    // Home page — fields always present (guaranteed by normalizeBrief)
    const home = cf(byPath.get("/"));
    if (home) {
      if (home.hero?.headline) pages.home.hero.headline = home.hero.headline;
      if (home.hero?.subheading) pages.home.hero.subheading = home.hero.subheading;
      if (home.hero?.ctaLabel) pages.home.hero.ctaLabel = home.hero.ctaLabel;
      if (home.valueProps?.length) pages.home.valueProps = home.valueProps.map((v: any) => ({ icon: "", headline: String(v.headline), body: String(v.body) }));
      if (home.testimonials?.length) pages.home.testimonials = home.testimonials.map((t: any) => ({ quote: String(t.quote), name: String(t.name), program: t.program ?? undefined }));
      if (home.faq?.length) pages.home.faq = home.faq.map((f: any) => ({ question: String(f.question), answer: String(f.answer) }));
      if (home.programsHeadline) pages.home.programsHeadline = home.programsHeadline;
      if (home.communityHeadline) pages.home.communityHeadline = home.communityHeadline;
      if (home.trustHeadline) pages.home.trustHeadline = home.trustHeadline;
      if (home.howItWorksHeadline) pages.home.howItWorksHeadline = home.howItWorksHeadline;
    }

    // Program pages
    for (const program of pages.programs) {
      const programEx = cf(byPath.get(`/programs/${program.slug}`));
      if (!programEx) continue;
      if (programEx.hero?.headline) program.hero.headline = programEx.hero.headline;
      if (programEx.hero?.subheading) program.hero.subheading = programEx.hero.subheading;
      if (programEx.shortDescription) program.shortDescription = programEx.shortDescription;
      if (programEx.whoIsItFor?.length) program.whoIsItFor = programEx.whoIsItFor.map(String);
      if (programEx.whatMakesUsDifferent?.length) program.whatMakesUsDifferent = programEx.whatMakesUsDifferent.map(String);
      if (programEx.testimonials?.length) program.testimonials = programEx.testimonials.map((t: any) => ({ quote: String(t.quote), name: String(t.name) }));
      if (programEx.faq?.length) program.faq = programEx.faq.map((f: any) => ({ question: String(f.question), answer: String(f.answer) }));
    }

    // About page
    const aboutEx = cf([...byPath.values()].find(p => p.pageType === "about"));
    if (aboutEx) {
      if (aboutEx.hero?.headline) pages.about.hero.headline = aboutEx.hero.headline;
      if (aboutEx.gymStory) pages.about.gymStory = aboutEx.gymStory;
      if (aboutEx.team?.length) pages.about.team = aboutEx.team.map((m: any) => ({ name: String(m.name), title: String(m.title), photoUrl: "", bio: m.bio ?? undefined }));
    }

    // Contact — also patch business NAP
    const contactEx = cf([...byPath.values()].find(p => p.pageType === "contact"));
    if (contactEx) {
      if (contactEx.phone && !business.phone) business.phone = contactEx.phone;
      if (contactEx.email && !business.email) business.email = contactEx.email;
      if (contactEx.address && !business.address.street) {
        business.address.street = contactEx.address;
        if (contactEx.city) { business.address.city = contactEx.city; business.geo.city = contactEx.city; }
        if (contactEx.state) { business.address.state = contactEx.state; business.geo.stateAbbr = contactEx.state; }
        if (contactEx.zip) business.address.zip = contactEx.zip;
      }
    }

    // Pricing page
    const pricingEx = cf([...byPath.values()].find(p => p.pageType === "pricing"));
    if (pricingEx?.plans?.length) {
      pages.pricing.grid = {
        headline: pricingEx.hero?.headline ?? undefined,
        plans: pricingEx.plans.map((plan: any) => ({
          name: String(plan.name),
          price: String(plan.price),
          period: plan.period ?? undefined,
          description: plan.description ?? undefined,
          features: Array.isArray(plan.features) ? plan.features.map(String) : [],
          cta: { label: "Get started", url: "/contact" },
        })),
      };
    }

    warnings.push(`content merged: ${contentArtifact.payload.pages.length} page briefs applied`);
  }

  // Ensure every internal CTA points to a page that will actually be rendered.
  sanitizeContentCtas(pages, business, warnings);

  const isImpact = inferImpactTheme(contract, pages.home);

  const meta: SiteMeta = {
    siteId: siteUuid,
    apiBaseUrl: config.apiBaseUrl,
    siteUrl: config.siteUrl,
    defaultTitle: business.name ? `${business.name} | ${business.geo.city} Gym` : `${DEFAULT_BUSINESS_NAME} | ${DEFAULT_CITY} Gym`,
    defaultDescription: business.tagline,
    preview: false,
    templateTheme: isImpact ? "impact" : "baseline",
  };

  return {
    content: { meta, business, brand, navigation, pages },
    warnings,
  };
}
