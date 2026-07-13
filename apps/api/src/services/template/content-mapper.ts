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
  ScheduleContent, BlogContent, LocalGuideContent, LegalPage, HeroContent, Feature,
} from "@ploy-gyms/shared-types";
import { loadArtifact } from "../../utils/pipeline/artifact-store";
import type { ContractArtifact, SectionContract } from "../../types/section-contract";
import type { EnrichArtifact } from "../../types/enrich-artifact";

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

function stripSeoSuffix(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  return name.split(" | ")[0]?.trim();
}

function parseAddressFromString(addrStr: string): { street: string; city: string; stateAbbr: string; zip: string } | null {
  if (!addrStr) return null;
  // Remove trailing country like "United States"
  const cleaned = addrStr.replace(/,?\s*United States$/i, "").trim();

  // Strict: "123 Main St, City, ST 12345" or "123 Main St City, ST 12345"
  const strictMatch = cleaned.match(
    /^(\d+\s[\w\s.]+?(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Way|Ln|Lane|Court|Ct|Pl(?:ace)?|Circle|Cir|Pkwy|Parkway|Hwy|Highway|Terr(?:ace)?|Trl|Trail|Ave|St)\.{0,1}),?\s*(?:Suite?\s*\d+\s*,?\s*)?([A-Za-z\s]+),\s*([A-Za-z\s]+),?\s*(\d{5}(-\d{4})?)$/i,
  );
  if (strictMatch) {
    return {
      street: strictMatch[1]!.trim(),
      city: strictMatch[2]!.trim(),
      stateAbbr: abbrFromState(strictMatch[3]!.trim()),
      zip: strictMatch[4]!.trim(),
    };
  }

  // "123 Main St, Torrance, California 90505" (full state name, no comma before zip)
  const fullStateMatch = cleaned.match(
    /^(\d+\s[\w\s.]+?(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Way|Ln|Lane|Court|Ct|Pl(?:ace)?|Circle|Cir|Pkwy|Parkway|Hwy|Highway|Terr(?:ace)?|Trl|Trail|Ave|St)\.{0,1}),?\s*(?:Suite?\s*\d+\s*,?\s*)?([A-Za-z\s]+?),\s*([A-Za-z\s]+)\s+(\d{5}(-\d{4})?)$/i,
  );
  if (fullStateMatch) {
    return {
      street: fullStateMatch[1]!.trim(),
      city: fullStateMatch[2]!.trim(),
      stateAbbr: abbrFromState(fullStateMatch[3]!.trim()),
      zip: fullStateMatch[4]!.trim(),
    };
  }

  // Loose: "City, ST 12345" (no street)
  const looseMatch = cleaned.match(/([A-Za-z\s]+),\s*([A-Za-z\s]+)\s+(\d{5}(-\d{4})?)$/i);
  if (looseMatch) {
    return {
      street: "",
      city: looseMatch[1]!.trim(),
      stateAbbr: abbrFromState(looseMatch[2]!.trim()),
      zip: looseMatch[3]!.trim(),
    };
  }

  return null;
}

function abbrFromState(state: string): string {
  const trimmed = state.trim();
  const upper = trimmed.toUpperCase();
  if (STATE_ABBRS[upper]) return upper; // already abbreviation
  const lower = trimmed.toLowerCase();
  for (const [abbr, full] of Object.entries(STATE_ABBRS)) {
    if (full.toLowerCase() === lower) return abbr;
  }
  return trimmed.slice(0, 2).toUpperCase();
}

function hoursFromString(hoursStr: string): BusinessInfo["hours"] {
  if (!hoursStr) return [];
  const lines = hoursStr.split("\n");
  const out: BusinessInfo["hours"] = [];
  for (const line of lines) {
    const m = line.match(/^\s*([\w-]+):\s*(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})\s*$/i);
    if (!m) continue;
    const days = m[1]!.split("-").map((d) => d.trim());
    out.push({ days, opens: m[2]!, closes: m[3]! });
  }
  return out;
}

function formatGmbHours(listingHours: { day: string; open?: string; close?: string; isOpen24Hours?: boolean; isClosed?: boolean }[] | undefined): BusinessInfo["hours"] {
  if (!listingHours) return [];
  return listingHours.map((h) => ({
    days: [h.day],
    opens: h.isOpen24Hours ? "00:00" : (h.open ?? ""),
    closes: h.isOpen24Hours ? "23:59" : (h.close ?? ""),
  }));
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


// ── Business ─────────────────────────────────────────────────────────────────

export function extractBusiness(
  markdown: string,
  ds: DesignSystemV2,
  warnings: string[],
  enrich: EnrichArtifact | null = null,
): BusinessInfo {
  const baseline = DEFAULT_BUSINESS_PLACEHOLDER;

  // ── Enrich artifact helpers ──────────────────────────────────────────────────
  const listing = enrich?.listing;
  const data = enrich?.data;

  const enrichName = stripSeoSuffix(listing?.name ?? data?.businessName);
  const enrichPhone = listing?.phoneNumber ?? data?.contact?.phone;
  const enrichEmail = data?.contact?.email;

  const enrichFullAddress =
    listing?.address?.fullAddress ??
    (listing?.address
      ? [
          [listing.address.streetNumber, listing.address.streetName].filter(Boolean).join(" "),
          listing.address.city,
          listing.address.state,
          listing.address.postalCode,
        ].filter(Boolean).join(", ")
      : undefined) ??
    data?.locations?.[0]?.address;
  const enrichAddress = enrichFullAddress ? parseAddressFromString(enrichFullAddress) : null;

  const enrichHours = listing?.regularOpeningHours?.length
    ? formatGmbHours(listing.regularOpeningHours)
    : data?.locations?.[0]?.hours
      ? hoursFromString(data.locations[0].hours)
      : [];

  const enrichTagline =
    listing?.editorialSummary ?? data?.tagline ?? data?.description;

  const enrichSocial: Partial<BusinessInfo["social"]> = {};
  for (const { platform, url } of data?.contact?.social ?? []) {
    if (platform && url && (platform === "facebook" || platform === "instagram" || platform === "twitter" || platform === "tiktok" || platform === "youtube")) {
      enrichSocial[platform] = url;
    }
  }

  const enrichRating = listing?.rating
    ? { ratingValue: String(listing.rating), reviewCount: listing.userRatingCount ?? 0 }
    : baseline.aggregateRating;

  // ── Markdown fallback extraction ───────────────────────────────────────────
  const labelLine = (label: string): string =>
    markdown.match(new RegExp(`(?:-\\s+)?\\*\\*${label}\\*\\*:\\s*(.+)`, "i"))?.[1]?.trim() ?? "";

  const nameFromLabel = labelLine("Business Name");
  const nameFromWelcome = markdown.match(/Welcome to ([^,.\n]+)[,.\n]/)?.[1]?.trim() ?? "";
  const nameFromH1 = stripSeoSuffix(markdown.match(/^-\s*\(h1\)\s*(.+)$/m)?.[1]?.trim());
  const nameFromTitle = stripSeoSuffix(markdown.match(/^#\s+(.+)$/m)?.[1]?.trim());

  const name = fallback(
    enrichName ||
    ds.business?.name ||
    ds.siteMetadata?.businessName ||
    nameFromLabel ||
    nameFromWelcome ||
    nameFromH1 ||
    nameFromTitle,
    baseline.name,
    warnings,
    "business.name",
  );

  const tagline = fallback(
    ds.business?.tagline ?? enrichTagline,
    baseline.tagline,
    warnings,
    "business.tagline",
  );

  // Phone / email: never fall back to placeholder email; leave empty if unknown.
  const phone = fallback(enrichPhone || labelLine("Phone"), baseline.phone, warnings, "phone");
  const email = enrichEmail || labelLine("Email") || undefined;

  // Address: prefer enrich artifact, then markdown label, then baseline
  let address = enrichAddress;
  if (!address?.city && !address?.stateAbbr) {
    const addrStr = labelLine("Address");
    address = parseAddressFromString(addrStr);
  }

  const street = fallback(address?.street, baseline.address.street, warnings, "address.street");
  const city = fallback(address?.city, baseline.address.city, warnings, "address.city");
  const stateAbbr = fallback(address?.stateAbbr, baseline.address.state, warnings, "address.state");
  const zip = fallback(address?.zip, baseline.address.zip, warnings, "address.zip");

  // Social links from labeled lines, merged with enrich. Never fall back to
  // placeholder social URLs when no real links were found.
  const socialPlatforms = ["facebook", "instagram", "twitter", "tiktok", "youtube"] as const;
  const social: Partial<Record<typeof socialPlatforms[number], string>> = { ...enrichSocial };
  for (const platform of socialPlatforms) {
    const url = labelLine(platform);
    if (url) social[platform] = url;
  }

  const primaryCta = ds.reference.homePagePrimaryCta
    ? { label: ds.reference.homePagePrimaryCta.label, url: ds.reference.homePagePrimaryCta.href }
    : baseline.primaryCta;

  const hours = enrichHours.length > 0 ? enrichHours : [];

  return {
    name,
    tagline,
    address: { street, city, state: stateAbbr, zip },
    phone,
    email,
    hours,
    primaryCta,
    trialCta: baseline.trialCta,
    geo: { city, state: STATE_ABBRS[stateAbbr] ?? stateAbbr, stateAbbr },
    serviceArea: baseline.serviceArea,
    aggregateRating: enrichRating,
    social: Object.keys(social).length > 0 ? (social as BusinessInfo["social"]) : undefined,
  };
}

// ── Brand ────────────────────────────────────────────────────────────────────

export function extractBrand(
  ds: DesignSystemV2,
  warnings: string[],
  businessName: string = "",
): BrandTokens {
  const c = ds.global.tokens.colors;
  const f = ds.global.tokens.fonts;
  const logo = ds.brand.logo;
  const baseline = DEFAULT_TEMPLATE_TOKENS;
  // Text-logo sites have no image URL; image-logo sites without a value render
  // as text as well so the footer/header never show a broken image.
  const logoUrl = logo.type === "image" ? (logo.value || "") : "";
  return {
    primaryColor: fallback(c.primary, baseline.colors.primary, warnings, "primaryColor"),
    secondaryColor: fallback(c.background, baseline.colors.foreground, warnings, "secondaryColor"),
    accentColor: fallback(c.foreground, baseline.colors.mutedForeground, warnings, "accentColor"),
    headingFont: fallback(f.heading, baseline.fonts.heading, warnings, "headingFont"),
    bodyFont: fallback(f.body, baseline.fonts.body, warnings, "bodyFont"),
    logoUrl,
    logoAlt: logo.alt || ds.business.name || businessName || DEFAULT_BUSINESS_NAME,
  };
}

// ── Page classification ───────────────────────────────────────────────────────

export function classifyPage(page: HierarchyPage): "home" | "about" | "contact" | "pricing" | "schedule" | "localGuide" | "blog" | "legal" | "program" {
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
  business: Pick<BusinessInfo, "name" | "primaryCta" | "geo">,
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
    ctaHeadline: "",
  };

  const programDescriptions: Record<string, string> = {
    "group-strength": "Small-group barbell and functional strength sessions scaled to every level.",
    "cardio-bootcamp": "High-energy interval training that builds endurance, burns calories, and keeps you moving.",
    "personal-training": "One-on-one coaching built around your goals, schedule, and starting point.",
  };

  const defaultPrograms: ProgramContent[] = DEFAULT_PROGRAMS.map((p) => ({
    slug: p.slug,
    name: p.name,
    shortDescription: programDescriptions[p.slug] ?? `Coach-led ${p.name.toLowerCase()} sessions designed for real results.`,
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
        shortDescription: (p.sections.find((s) => s.tag === "hero")?.content.body ?? "").slice(0, 160) || programDescriptions[p.slug] || `Coach-led ${p.title.toLowerCase()} sessions designed for real results.`.slice(0, 160),
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

  // Helper for contextual page hero fallbacks when site-hierarchy lacks a distinct page.
  const pageHeroFallback = (pageKey: "about" | "pricing" | "contact" | "schedule" | "localGuide") => {
    const page = byClass(pageKey)[0];
    if (page) {
      const fromHierarchy = heroFromPage(page);
      if (fromHierarchy.headline) return fromHierarchy;
    }
    const city = business.geo?.city ?? "";
    const stateAbbr = business.geo?.stateAbbr ?? "";
    const location = city ? (stateAbbr ? `${city}, ${stateAbbr}` : city) : "";
    const base: HeroContent = {
      headline: business.name || DEFAULT_BUSINESS_NAME,
      backgroundImageUrl: NO_IMAGE,
    };
    switch (pageKey) {
      case "about":
        base.headline = location ? `About ${business.name} in ${location}` : `About ${business.name}`;
        break;
      case "pricing":
        base.headline = location ? `Memberships and rates in ${location}` : "Memberships and rates";
        break;
      case "contact":
        base.headline = location ? `Visit us in ${location}` : "Get in touch";
        break;
      case "schedule":
        base.headline = location ? `Class schedule in ${location}` : "Class schedule";
        break;
      case "localGuide":
        base.headline = location ? `Your fitness guide to ${location}` : "Local fitness guide";
        break;
    }
    return base;
  };

  const about: AboutContent = {
    hero: pageHeroFallback("about"),
    gymStory: "",
    team: [],
  };

  const pricing: PricingContent = {
    hero: pageHeroFallback("pricing"),
  };

  const contact: ContactContent = {
    hero: pageHeroFallback("contact"),
  };

  const schedule: ScheduleContent = {
    hero: pageHeroFallback("schedule"),
  };

  const localGuide: LocalGuideContent = {
    hero: pageHeroFallback("localGuide"),
    sections: [],
  };

  const blog: BlogContent = { heroHeadline: "Our Blog", posts: [] };

  const legal: LegalPage[] = byClass("legal").map((p) => ({
    slug: p.slug,
    title: p.title,
    blocks: [],
  }));

  return { home, programs, about, pricing, contact, schedule, blog, localGuide, legal };
}

// Build a useful default meta description when the extracted tagline is missing
// or too short for search results. Keep it within 150–160 characters.
function buildDefaultDescription(business: BusinessInfo, home: HomeContent): string {
  const base =
    home.hero.intro ||
    business.tagline ||
    `${business.name} is a gym in ${business.geo.city}, ${business.geo.stateAbbr}.`;
  const suffix = ` Join ${business.name} in ${business.geo.city} for personalized training and a supportive community.`;
  let combined = `${base}${suffix}`;
  if (combined.length > 160) {
    combined = `${base.slice(0, Math.max(0, 160 - suffix.length - 3)).replace(/\s+\S*$/, "")}...${suffix}`;
  }
  return combined.length < 120
    ? `${combined} Start your fitness journey today.`
    : combined;
}

// Generic fallback legal pages so the cookie-banner privacy link and any footer
// legal references always resolve. Replace with gym-specific docs once available.
function defaultLegalPages(business: BusinessInfo): LegalPage[] {
  const name = business.name;
  const year = new Date().getFullYear();
  return [
    {
      slug: "privacy-policy",
      title: "Privacy Policy",
      blocks: [
        {
          type: "text",
          html: `<p>${name} (“we”, “us”, or “our”) respects your privacy. This Privacy Policy explains how we collect, use, and protect your personal information when you visit our website or use our services.</p>
          <h2>Information we collect</h2>
          <p>We may collect contact details (such as name, email, and phone number), billing information, and usage data when you fill out forms, book classes, or interact with our site.</p>
          <h2>How we use your information</h2>
          <p>We use the information we collect to provide and improve our services, communicate with you, process payments, and comply with legal obligations.</p>
          <h2>Cookies and tracking</h2>
          <p>Our site may use cookies and similar technologies to understand how visitors use our site and to improve your experience. You can control cookies through your browser settings.</p>
          <h2>Third-party services</h2>
          <p>We may share information with trusted service providers who help us operate our business (for example, payment processors and scheduling platforms). We do not sell your personal information.</p>
          <h2>Contact us</h2>
          <p>If you have questions about this Privacy Policy, please contact us at ${business.email || "privacy@" + name.toLowerCase().replace(/\s+/g, "") + ".com"}.</p>
          <p>Last updated: ${year}.</p>`,
        },
      ],
    },
    {
      slug: "terms-of-service",
      title: "Terms of Service",
      blocks: [
        {
          type: "text",
          html: `<p>By accessing or using the ${name} website and services, you agree to these Terms of Service.</p>
          <h2>Membership and payments</h2>
          <p>Membership fees are billed according to the plan you select. Cancellations and refunds are handled per the agreement you sign when you join.</p>
          <h2>Health and safety</h2>
          <p>You acknowledge that physical exercise involves risk. Consult a physician before beginning any fitness program and follow coach instructions to reduce the chance of injury.</p>
          <h2>Contact</h2>
          <p>For questions about these terms, contact us at ${business.email || "support@" + name.toLowerCase().replace(/\s+/g, "") + ".com"}.</p>
          <p>Last updated: ${year}.</p>`,
        },
      ],
    },
  ];
}

// ── Contract-aware mapping helpers ────────────────────────────────────────────

function inferTemplateTheme(contract: ContractArtifact | null, _home: HomeContent): SiteMeta["templateTheme"] {
  if (!contract) return "baseline";
  const homeSections = contract.pages.find((p) => p.isHomePage)?.sections ?? [];

  // Beanburito signal: dark, bold, community-focused template. Detect a sticky
  // headline panel paired with a dark program-card layout.
  const hasBeanburitoSignal = homeSections.some((s) =>
    s.layout.archetype === "program-cards-sticky" &&
    s.layout.background.color?.toLowerCase() === "#000000" ||
    s.layout.background.color?.toLowerCase() === "black"
  );
  if (hasBeanburitoSignal) return "beanburito";

  // Impact signal: bold bento feature grid or sticky program cards without the
  // dark/community styling.
  const hasImpactSignal = homeSections.some((s) =>
    s.layout.archetype.startsWith("feature-grid") ||
    s.layout.archetype === "program-cards-sticky"
  );
  if (hasImpactSignal) return "impact";

  return "baseline";
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
  /** Google Maps API key used to build embed URLs from GMB place IDs. */
  googleMapsApiKey?: string;
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

  const resolvedWorkspaceUuid = workspaceUuid ?? config.workspaceUuid ?? "";

  let contract: ContractArtifact | null = null;
  if (resolvedWorkspaceUuid) {
    const artifact = await loadArtifact<ContractArtifact>(
      db,
      { siteUuid, workspaceUuid: resolvedWorkspaceUuid },
      "contract",
    ).catch(() => null);
    contract = artifact?.payload ?? null;
  }

  const enrichArtifact = await loadArtifact<EnrichArtifact>(
    db,
    { siteUuid, workspaceUuid: resolvedWorkspaceUuid },
    "enrich",
  ).catch(() => null);
  if (!enrichArtifact?.payload) {
    warnings.push("enrich artifact missing — business NAP may fall back to placeholders");
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

  let business = extractBusiness(bizDoc?.content ?? "", ds, warnings, enrichArtifact?.payload ?? null);
  const brand = extractBrand(ds, warnings, business.name);

  // Build a Google Maps embed URL from the business name + address. We use the
  // classic output=embed endpoint because the Maps Embed API requires a separate
  // API-key activation that is easy to miss in new projects.
  if (!business.mapEmbedUrl && business.address?.street) {
    const q = encodeURIComponent(
      `${business.name}, ${business.address.street}, ${business.address.city}, ${business.geo.stateAbbr} ${business.address.zip}`,
    );
    business = {
      ...business,
      mapEmbedUrl: `https://www.google.com/maps?q=${q}&output=embed`,
    };
  }

  const navigation = extractNavigation(hierarchy, warnings);
  const pages = extractPages(hierarchy, business, warnings, contract);

  // ── Phase 2: merge page briefs from content artifact ──────────────────────
  type ContentBrief = { contentFound?: Record<string, unknown>; data?: Record<string, unknown> };
  type ContentArtifactPayload = { pages: Array<ContentBrief & { path: string; pageType: string }> };

  const contentArtifact = await loadArtifact<ContentArtifactPayload>(
    db,
    { siteUuid, workspaceUuid: resolvedWorkspaceUuid },
    "content",
  );

  if (contentArtifact?.payload?.pages?.length) {
    const byPath = new Map(contentArtifact.payload.pages.map(p => [p.path, p]));

    // Resolve per-page content: new brief format uses contentFound, old format used data
    const cf = (p: ContentBrief | undefined): Record<string, unknown> | null =>
      p?.contentFound ?? p?.data ?? null;

    // Home page — fields always present (guaranteed by normalizeBrief)
    const home = cf(byPath.get("/"));
    if (home) {
      const homeHero = home.hero as Record<string, unknown> | undefined;
      if (homeHero?.headline) pages.home.hero.headline = String(homeHero.headline);
      if (homeHero?.subheading) pages.home.hero.subheading = String(homeHero.subheading);
      if (homeHero?.ctaLabel) pages.home.hero.ctaLabel = String(homeHero.ctaLabel);
      if (Array.isArray(home.valueProps) && home.valueProps.length > 0) {
        pages.home.valueProps = home.valueProps.map((v: unknown) => {
          const item = v as Record<string, unknown>;
          return { icon: "", headline: String(item.headline ?? ""), body: String(item.body ?? "") };
        });
      }
      if (Array.isArray(home.testimonials) && home.testimonials.length > 0) {
        pages.home.testimonials = home.testimonials.map((t: unknown) => {
          const item = t as Record<string, unknown>;
          return { quote: String(item.quote ?? ""), name: String(item.name ?? ""), program: item.program ? String(item.program) : undefined };
        });
      }
      if (Array.isArray(home.faq) && home.faq.length > 0) {
        pages.home.faq = home.faq.map((f: unknown) => {
          const item = f as Record<string, unknown>;
          return { question: String(item.question ?? ""), answer: String(item.answer ?? "") };
        });
      }
      if (home.programsHeadline) pages.home.programsHeadline = String(home.programsHeadline);
      if (home.communityHeadline) pages.home.communityHeadline = String(home.communityHeadline);
      if (home.trustHeadline) pages.home.trustHeadline = String(home.trustHeadline);
      if (home.howItWorksHeadline) pages.home.howItWorksHeadline = String(home.howItWorksHeadline);
    }

    // Program pages
    for (const program of pages.programs) {
      const programEx = cf(byPath.get(`/programs/${program.slug}`));
      if (!programEx) continue;
      const programHero = programEx.hero as Record<string, unknown> | undefined;
      if (programHero?.headline) program.hero.headline = String(programHero.headline);
      if (programHero?.subheading) program.hero.subheading = String(programHero.subheading);
      if (programEx.shortDescription) program.shortDescription = String(programEx.shortDescription);
      if (Array.isArray(programEx.whoIsItFor) && programEx.whoIsItFor.length > 0) {
        program.whoIsItFor = programEx.whoIsItFor.map(String);
      }
      if (Array.isArray(programEx.whatMakesUsDifferent) && programEx.whatMakesUsDifferent.length > 0) {
        program.whatMakesUsDifferent = programEx.whatMakesUsDifferent.map(String);
      }
      if (Array.isArray(programEx.testimonials) && programEx.testimonials.length > 0) {
        program.testimonials = programEx.testimonials.map((t: unknown) => {
          const item = t as Record<string, unknown>;
          return { quote: String(item.quote ?? ""), name: String(item.name ?? "") };
        });
      }
      if (Array.isArray(programEx.faq) && programEx.faq.length > 0) {
        program.faq = programEx.faq.map((f: unknown) => {
          const item = f as Record<string, unknown>;
          return { question: String(item.question ?? ""), answer: String(item.answer ?? "") };
        });
      }
    }

    // About page
    const aboutEx = cf([...byPath.values()].find(p => p.pageType === "about"));
    if (aboutEx) {
      const aboutHero = aboutEx.hero as Record<string, unknown> | undefined;
      if (aboutHero?.headline) pages.about.hero.headline = String(aboutHero.headline);
      if (aboutEx.gymStory) pages.about.gymStory = String(aboutEx.gymStory);
      if (Array.isArray(aboutEx.team) && aboutEx.team.length > 0) {
        pages.about.team = aboutEx.team.map((m: unknown) => {
          const item = m as Record<string, unknown>;
          return { name: String(item.name ?? ""), title: String(item.title ?? ""), photoUrl: "", bio: item.bio ? String(item.bio) : undefined };
        });
      }
    }

    // Contact — also patch business NAP
    const contactEx = cf([...byPath.values()].find(p => p.pageType === "contact"));
    if (contactEx) {
      if (contactEx.phone && !business.phone) business.phone = String(contactEx.phone);
      if (contactEx.email && !business.email) business.email = String(contactEx.email);
      if (contactEx.address && !business.address.street) {
        business.address.street = String(contactEx.address);
        if (contactEx.city) { business.address.city = String(contactEx.city); business.geo.city = String(contactEx.city); }
        if (contactEx.state) { business.address.state = String(contactEx.state); business.geo.stateAbbr = String(contactEx.state); }
        if (contactEx.zip) business.address.zip = String(contactEx.zip);
      }
    }

    // Pricing page
    const pricingEx = cf([...byPath.values()].find(p => p.pageType === "pricing"));
    if (pricingEx && Array.isArray(pricingEx.plans) && pricingEx.plans.length > 0) {
      const pricingHero = pricingEx.hero as Record<string, unknown> | undefined;
      pages.pricing.grid = {
        headline: pricingHero?.headline ? String(pricingHero.headline) : undefined,
        plans: pricingEx.plans.map((plan: unknown) => {
          const item = plan as Record<string, unknown>;
          return {
            name: String(item.name ?? ""),
            price: String(item.price ?? ""),
            period: item.period ? String(item.period) : undefined,
            description: item.description ? String(item.description) : undefined,
            features: Array.isArray(item.features) ? item.features.map(String) : [],
            cta: { label: "Get started", url: "/contact" },
          };
        }),
      };
    }

    warnings.push(`content merged: ${contentArtifact.payload.pages.length} page briefs applied`);
  }

  // Always provide fallback privacy/terms pages so the cookie banner and footer
  // links resolve. Gym-specific legal docs can replace these later.
  if (pages.legal.length === 0) {
    pages.legal = defaultLegalPages(business);
  }

  // Ensure every internal CTA points to a page that will actually be rendered.
  sanitizeContentCtas(pages, business, warnings);

  // Theme selection order of precedence:
  // 1. Explicit site theme stored on the site row (set by admin/AI).
  // 2. Contract-driven beanburito signal (bold sticky headline + dark contrast).
  // 3. Contract-driven impact signal (bento feature grid).
  // 4. Default baseline.
  const inferredTemplateTheme = inferTemplateTheme(contract, pages.home);

  const meta: SiteMeta = {
    siteId: siteUuid,
    apiBaseUrl: config.apiBaseUrl,
    siteUrl: config.siteUrl,
    defaultTitle: business.name ? `${business.name} | ${business.geo.city} Gym` : `${DEFAULT_BUSINESS_NAME} | ${DEFAULT_CITY} Gym`,
    defaultDescription: buildDefaultDescription(business, pages.home),
    preview: false,
    templateTheme: inferredTemplateTheme,
  };

  return {
    content: { meta, business, brand, navigation, pages },
    warnings,
  };
}
