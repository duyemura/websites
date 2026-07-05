import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import type { SiteHierarchy, HierarchyPage } from "../../types/site-hierarchy";
import type { BusinessInfoExtractionResult } from "../../ai/prompts/business-info-extraction";
import type {
  GymSiteContent, SiteMeta, BrandTokens, BusinessInfo,
  Navigation, NavItem, FooterGroup, PageContent, HomeContent,
  ProgramContent, AboutContent, PricingContent, ContactContent,
  ScheduleContent, BlogContent, LegalPage, HeroContent,
} from "@ploy-gyms/shared-types";

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
    accentColor: fallback(c.foreground, "#f1f1f1", warnings, "accentColor"),
    headingFont: fallback(f.heading, "Inter", warnings, "headingFont"),
    bodyFont: fallback(f.body, "Inter", warnings, "bodyFont"),
    logoUrl: logo.type === "image" ? (logo.value || fallback("", "", warnings, "logoUrl")) : "",
    logoAlt: logo.alt || ds.business.name || "",
  };
}

// ── Business ─────────────────────────────────────────────────────────────────

export function extractBusiness(
  markdown: string,
  ds: DesignSystemV2,
  warnings: string[],
  structured?: BusinessInfoExtractionResult | null,
): BusinessInfo {
  // Prefer LLM-extracted structured data; fall back to markdown regex for
  // manually authored or legacy docs that have no contentJson.
  const name = fallback(
    structured?.businessName || ds.business.name || ds.siteMetadata.businessName,
    "", warnings, "business.name"
  );
  const tagline = structured?.tagline || ds.business.tagline || "";

  const phone = structured?.contact.phone ||
    markdown.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/)?.[0] || "";
  if (!phone) warnings.push("phone not found — using empty string");

  const email = structured?.contact.email ||
    markdown.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)?.[0];

  // Address: prefer structured location.address string (clean single field),
  // fall back to searching full markdown
  const addrSource = structured?.location?.address || markdown;
  const addrMatch = addrSource.match(
    /(\d+\s+[\w\s]+?(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Way|Ln|Lane|Court|Ct|Pl(?:ace)?|Circle|Cir|Pkwy|Parkway|Hwy|Highway|Terr(?:ace)?|Trl|Trail)\.?),?\s*(?:Suite?\s*\d+\s*,\s*)?([\w\s]+?),\s*([A-Z]{2})\s+(\d{5})/i,
  );
  const looseMatch = !addrMatch
    ? addrSource.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\s+(\d{5})/i)
    : null;
  const street = addrMatch?.[1]?.trim() ?? fallback("", "", warnings, "address.street");
  const city = addrMatch?.[2]?.trim() ?? looseMatch?.[1]?.trim() ?? fallback("", "", warnings, "address.city");
  const stateAbbr = (addrMatch?.[3] ?? looseMatch?.[2])?.toUpperCase() ?? fallback("", "", warnings, "address.state");
  const zip = addrMatch?.[4] ?? looseMatch?.[3] ?? fallback("", "", warnings, "address.zip");

  const primaryCta = ds.reference.homePagePrimaryCta
    ? { label: ds.reference.homePagePrimaryCta.label, url: ds.reference.homePagePrimaryCta.href }
    : { label: "Get started", url: "/" };

  // Social links from structured extraction
  const social = structured?.contact.socials?.length
    ? Object.fromEntries(
        structured.contact.socials.map((s) => [s.platform.toLowerCase(), s.url])
      )
    : undefined;

  return {
    name,
    tagline,
    address: { street, city, state: stateAbbr, zip },
    phone,
    email: email || undefined,
    hours: [],
    primaryCta,
    geo: { city, state: STATE_ABBRS[stateAbbr] ?? stateAbbr, stateAbbr },
    social: social as BusinessInfo["social"],
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
  const structuredBiz = bizDoc?.contentJson as BusinessInfoExtractionResult | null ?? null;
  const business = extractBusiness(bizDoc?.content ?? "", ds, warnings, structuredBiz);
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
