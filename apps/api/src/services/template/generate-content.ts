/**
 * Spec-driven content generation.
 *
 * Reads all site docs + the content artifact, then calls an LLM with the
 * template's content spec to fill every homepage slot with gym-specific copy.
 * Returns a complete GymSiteContent ready to pass directly to deployTemplate.
 *
 * Architecture:
 * - content-mapper handles: brand tokens, business NAP, navigation (deterministic doc parsing)
 * - generate-content handles: hero, value props, how-it-works, features, community (LLM w/ spec)
 * - content artifact handles: testimonials, FAQ (real content extracted from site)
 */

import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import type { GymSiteContent, HomeContent, HeroContent, ValueProp, Step, Feature, FAQItem, Testimonial, Navigation, NavItem, FooterGroup } from "@ploy-gyms/shared-types";
import { beanburitoSpec, buildSpecPrompt } from "./specs/beanburito.js";
import { chatCompletion } from "../../ai/llm-client.js";

export interface GenerateContentInput {
  db: Kysely<DB>;
  config: Config;
  s3Client: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  apiBaseUrl: string;
  siteUrl: string;
  templateTheme?: "baseline" | "impact" | "beanburito";
  log?: (msg: string) => void;
}

/** Raw LLM output for the home page sections we generate. */
interface GeneratedHomeSlots {
  hero: {
    subheading?: string;
    headline: string;
    intro?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  };
  valueProps: Array<{ headline: string; body: string }>;
  howItWorks: Array<{ headline: string; body: string }>;
  howItWorksHeadline: string;
  features: Array<{ label: string }>;
  communityHeadline: string;
  trustHeadline: string;
  serviceArea?: string[];
}

// ── Doc loading ──────────────────────────────────────────────────────────────

async function loadDoc(db: Kysely<DB>, siteUuid: string, key: string): Promise<string> {
  const row = await db
    .selectFrom("docs")
    .select("content")
    .where("siteUuid", "=", siteUuid)
    .where("key", "=", key)
    .where("status", "=", "active")
    .executeTakeFirst();
  return row?.content ?? "";
}

async function loadContentArtifact(db: Kysely<DB>, siteUuid: string): Promise<any | null> {
  const row = await (db as any)
    .selectFrom("pipelineArtifacts")
    .select("payload")
    .where("siteUuid", "=", siteUuid)
    .where("stage", "=", "content")
    .orderBy("version", "desc")
    .executeTakeFirst();
  return row?.payload ?? null;
}

// ── Context builder ──────────────────────────────────────────────────────────

function extractJsonObject(raw: string): string | undefined {
  const start = raw.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0, inString = false, escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) { escape = false; }
      else if (ch === "\\") { escape = true; }
      else if (ch === '"') { inString = false; }
    } else if (ch === '"') { inString = true; }
    else if (ch === "{") { depth++; }
    else if (ch === "}") { depth--; if (depth === 0) return raw.slice(start, i + 1); }
  }
  return undefined;
}

function buildContextFromArtifact(artifact: any): string {
  if (!artifact?.pages?.length) return "";
  const lines: string[] = ["CONTENT FOUND ON THEIR WEBSITE:"];

  for (const page of artifact.pages as any[]) {
    const cf = page.contentFound ?? page.data ?? {};
    const hero = cf.hero ?? {};
    lines.push(`\nPage: ${page.path} (${page.pageType})`);
    if (page.purpose) lines.push(`  Purpose: ${page.purpose}`);
    if (hero.headline) lines.push(`  Hero headline: "${hero.headline}"`);
    if (hero.subheading) lines.push(`  Hero subheading: "${hero.subheading}"`);
    if (cf.body && cf.body.length > 20) lines.push(`  Body text: ${cf.body.slice(0, 600)}`);
    if (cf.testimonials?.length) {
      lines.push(`  Testimonials (${cf.testimonials.length} found):`);
      for (const t of cf.testimonials.slice(0, 5)) {
        lines.push(`    - "${t.quote}" — ${t.name}${t.program ? ` (${t.program})` : ""}`);
      }
    }
    if (cf.faq?.length) {
      lines.push(`  FAQ (${cf.faq.length} found):`);
      for (const f of cf.faq.slice(0, 7)) {
        lines.push(`    Q: ${f.question}`);
        lines.push(`    A: ${f.answer}`);
      }
    }
    if (cf.valueProps?.length) {
      lines.push(`  Value props found:`);
      for (const v of cf.valueProps) lines.push(`    - ${v.headline}: ${v.body}`);
    }
  }
  return lines.join("\n");
}

// ── Navigation builder ───────────────────────────────────────────────────────

/**
 * Build site navigation from actual crawled pages + content briefs.
 *
 * Rules:
 * 1. Only link to Astro template routes that exist (/about, /pricing, etc.)
 * 2. Only include a route if the gym's crawl contains that page type
 * 3. Label from the original path slug when it's more descriptive than the type
 *    (e.g. /membership-pricing → "Membership" rather than "Pricing")
 */
function buildNavigation(
  crawlPages: Array<{ path: string }>,
  contentBriefs: Array<{ path: string; pageType: string }>,
  programs: Array<{ slug: string; name: string }>,
  capturedNav: Array<{ label: string; href: string; children?: any[] }> = [],
): Navigation {
  void crawlPages; // available via contentBriefs — paths used for label derivation only
  const types = new Set(contentBriefs.map((b) => b.pageType));

  // Template routes the Astro renderer knows how to handle
  const TEMPLATE_ROUTES: Record<string, string> = {
    "/about": "/about", "/contact": "/contact", "/pricing": "/pricing",
    "/schedule": "/schedule", "/blog": "/blog", "/programs": "/programs",
    "/local-guide": "/local-guide",
  };

  // Map an original site href to the closest template route (keep label, change href)
  function mapToTemplateRoute(href: string): string {
    if (!href || href === "/") return "/";
    const lower = href.toLowerCase().replace(/\/$/, "");
    // Exact match
    if (TEMPLATE_ROUTES[lower]) return TEMPLATE_ROUTES[lower];
    // Prefix match: /membership-pricing → /pricing, /crossfit → /programs/crossfit
    if (lower.includes("pricing") || lower.includes("membership")) return "/pricing";
    if (lower.includes("about")) return "/about";
    if (lower.includes("contact")) return "/contact";
    if (lower.includes("schedule") || lower.includes("classes")) return "/schedule";
    if (lower.includes("blog") || lower.includes("news")) return "/blog";
    if (lower.includes("guide")) return "/local-guide";
    if (lower.startsWith("/programs/") || lower.includes("crossfit") || lower.includes("bootcamp") || lower.includes("training")) {
      const slug = lower.split("/").pop() ?? lower.replace("/", "");
      return `/programs/${slug}`;
    }
    // Keep original href — template will redirect if needed
    return href;
  }

  function convertNavItems(items: Array<{ label: string; href: string; children?: any[] }>): NavItem[] {
    return items
      .filter((i) => i.label && !/(login|sign in|sign up|account|search|cart)/i.test(i.label))
      .map((i) => ({
        label: i.label,
        href: mapToTemplateRoute(i.href),
        ...(i.children?.length ? { children: convertNavItems(i.children) } : {}),
      }));
  }

  // ── Header nav ───────────────────────────────────────────────────────────
  let header: NavItem[];

  if (capturedNav.length > 0) {
    // Use the gym's real nav structure — labels, hierarchy, and order preserved
    header = convertNavItems(capturedNav);
  } else {
    // Fallback: infer from crawl page types when nav-structure.json not yet available.
    // Use page types to find routes, but derive labels from the original path slug
    // (e.g. /membership-pricing → "Membership", /our-story → "Our Story").
    // Never assume what the gym calls their pages.
    header = [{ label: "Home", href: "/" }];
    if (programs.length > 0) {
      header.push({
        label: "Programs", href: "/programs",
        children: programs.map((p) => ({ label: p.name, href: `/programs/${p.slug}` })),
      });
    }
    // For each content page type, find the original path and derive a label from its slug
    for (const { type, templateHref } of [
      { type: "schedule", templateHref: "/schedule" },
      { type: "pricing", templateHref: "/pricing" },
      { type: "about", templateHref: "/about" },
      { type: "contact", templateHref: "/contact" },
    ]) {
      if (!types.has(type)) continue;
      const originalPath = contentBriefs.find((b) => b.pageType === type)?.path ?? templateHref;
      // Derive label: /membership-pricing → "Membership", /our-story → "Our Story"
      const slug = originalPath.replace(/^\//, "").split("/")[0] ?? type;
      const label = slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
      header.push({ label, href: templateHref });
    }
  }

  // Footer — derive from the header nav so labels always match what the gym calls their pages.
  // Never hardcode page names or paths: "blog" might be "writings", "/about" might be "/our-story".
  const footerCompanyLinks = header
    .filter((i) => i.href !== "/")  // skip Home in footer
    .map((i) => ({ label: i.label, href: i.href }));
  footerCompanyLinks.push({ label: "Privacy Policy", href: "/legal/privacy-policy" });

  const footer: FooterGroup[] = [
    {
      label: "Programs",
      links: programs.slice(0, 4).map((p) => ({ label: p.name, href: `/programs/${p.slug}` })),
    },
    { label: "Company", links: footerCompanyLinks },
  ];

  return { header, footer };
}

// ── Main generation ──────────────────────────────────────────────────────────

export async function generateSiteContent(input: GenerateContentInput): Promise<GymSiteContent> {
  const { db, config, siteUuid, workspaceUuid, apiBaseUrl, siteUrl, log = () => {} } = input;
  const theme = input.templateTheme ?? "beanburito";

  log(`  Loading docs and artifacts...`);

  // Load all available docs in parallel
  const [businessInfo, brandGuidelines, siteStrategy, siteHierarchy] = await Promise.all([
    loadDoc(db, siteUuid, "business-info"),
    loadDoc(db, siteUuid, "brand-guidelines"),
    loadDoc(db, siteUuid, "site-strategy"),
    loadDoc(db, siteUuid, "site-hierarchy"),
  ]);

  const contentArtifact = await loadContentArtifact(db, siteUuid);

  // Load crawl artifact for page list — used to build navigation
  const crawlArtifact = await (db as any)
    .selectFrom("pipelineArtifacts")
    .select("payload")
    .where("siteUuid", "=", siteUuid)
    .where("stage", "=", "mirror-crawl")
    .orderBy("version", "desc")
    .executeTakeFirst();
  const crawlPages: Array<{ path: string }> = crawlArtifact?.payload?.pages ?? [];

  // Load mirror deploy prefix so we can resolve hero image URLs
  const mirrorDeployArtifact = await (db as any)
    .selectFrom("pipelineArtifacts")
    .select("payload")
    .where("siteUuid", "=", siteUuid)
    .where("stage", "=", "mirror-deploy")
    .orderBy("version", "desc")
    .executeTakeFirst();
  const mirrorDeployPrefix: string = mirrorDeployArtifact?.payload?.deployPrefix ?? "";

  // Load nav structure captured during clone (saved as nav-structure.json from homepage HTML)
  let capturedNav: Array<{ label: string; href: string; children?: any[] }> = [];
  if (mirrorDeployPrefix) {
    try {
      const bucket = input.config.S3_DEPLOYMENTS_BUCKET ?? input.config.S3_ASSETS_BUCKET;
      const obj = await input.s3Client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: `${mirrorDeployPrefix}/nav-structure.json`,
      }));
      capturedNav = JSON.parse(await obj.Body?.transformToString() ?? "[]");
      log(`  Nav from original site: ${capturedNav.map(i => i.label).join(", ")}`);
    } catch { /* nav-structure.json not yet present — run clone to capture */ }
  }

  // Load hero image URL captured during clone (saved as hero-image.txt alongside outline.txt)
  let heroImageUrl: string | undefined;
  if (mirrorDeployPrefix) {
    try {
      const bucket = input.config.S3_DEPLOYMENTS_BUCKET ?? input.config.S3_ASSETS_BUCKET;
      const obj = await input.s3Client.send(new GetObjectCommand({
        Bucket: bucket,
        Key: `${mirrorDeployPrefix}/hero-image.txt`,
      }));
      const relativeUrl = (await obj.Body?.transformToString() ?? "").trim();
      if (relativeUrl.startsWith("/_assets/")) {
        // Use the immutable mirror deploy prefix — stays valid even after template replaces staging
        heroImageUrl = relativeUrl; // relative /_assets/ path — template deploy copies assets in
        log(`  Hero image: ${heroImageUrl}`);
      }
    } catch { /* hero-image.txt not yet present — run clone again to capture */ }
  }

  // Get base GymSiteContent from content-mapper (handles brand, business NAP, nav, programs)
  log(`  Building base content from docs...`);
  const { buildGymJson } = await import("./content-mapper.js");
  const { content: baseContent, warnings: mapperWarnings } = await buildGymJson(
    db, siteUuid, { apiBaseUrl, siteUrl }, workspaceUuid,
  );
  if (mapperWarnings.length > 0) {
    log(`  [mapper] ${mapperWarnings.slice(0, 3).join(", ")}${mapperWarnings.length > 3 ? ` (+${mapperWarnings.length - 3} more)` : ""}`);
  }

  // Pick spec based on theme (only beanburito for now — baseline/impact get spec-driven later)
  const spec = theme === "beanburito" ? beanburitoSpec : null;
  if (!spec) {
    log(`  No spec for theme "${theme}" — returning base content`);
    return baseContent;
  }

  // Extract testimonials and FAQ from content artifact (real content, not generated)
  const homePage = contentArtifact?.pages?.find((p: any) => p.path === "/");
  const homeCf = homePage?.contentFound ?? homePage?.data ?? {};
  const existingTestimonials: Testimonial[] = (homeCf.testimonials ?? [])
    .filter((t: any) => t.quote && t.name)
    .map((t: any) => ({ quote: String(t.quote), name: String(t.name), program: t.program ?? undefined }));
  const existingFaq: FAQItem[] = (homeCf.faq ?? [])
    .filter((f: any) => f.question && f.answer)
    .map((f: any) => ({ question: String(f.question), answer: String(f.answer) }));

  const artifactContext = buildContextFromArtifact(contentArtifact);

  // Trim business-info: remove the Testimonials section (long, LLM-busting)
  // Testimonials come from the content artifact separately
  const businessInfoTrimmed = (businessInfo || "")
    .replace(/^## Testimonials[\s\S]*$/m, "")
    .trim()
    .slice(0, 1500);

  // Build the LLM prompt
  const specPrompt = buildSpecPrompt(spec);
  const prompt = `You are writing homepage content for a gym website. Use ONLY the gym's real information from the docs below. Be specific — use their actual name, city, programs, and story. Never use placeholder text.

## GYM DOCS

### Business Info
${businessInfoTrimmed || "(not available)"}

### Brand & Voice Guidelines
${(brandGuidelines || "").slice(0, 800)}

### Marketing Strategy
${(siteStrategy || "").slice(0, 600)}

### Site Structure (pages and programs they have)
${siteHierarchy ? siteHierarchy.slice(0, 1500) : "(not available)"}

${artifactContext ? artifactContext.slice(0, 1500) : ""}

---

## YOUR TASK

${specPrompt}

---

## OUTPUT FORMAT

Return ONLY valid JSON with this exact shape. No markdown, no explanation:

{
  "hero": {
    "subheading": "string (3-5 words, ALL-CAPS label)",
    "headline": "string (4-8 words, bold outcome statement)",
    "intro": "string (1-2 sentences, specific proof point)",
    "ctaLabel": "string (2-4 words, action button)",
    "ctaUrl": "string (URL, use /contact if unknown)"
  },
  "valueProps": [
    { "headline": "string (2-5 words)", "body": "string (15-25 words)" },
    { "headline": "string", "body": "string" },
    { "headline": "string", "body": "string" }
  ],
  "howItWorks": [
    { "headline": "string (step name, 2-5 words)", "body": "string (15-25 words)" },
    { "headline": "string", "body": "string" },
    { "headline": "string", "body": "string" }
  ],
  "howItWorksHeadline": "string (4-7 words)",
  "features": [
    { "label": "string (2-4 words)" },
    { "label": "string" },
    { "label": "string" },
    { "label": "string" },
    { "label": "string" },
    { "label": "string" }
  ],
  "communityHeadline": "string (4-8 words, emotional, about belonging)",
  "trustHeadline": "string (5-10 words, social proof)",
  "serviceArea": ["real nearby city 1", "real nearby city 2", "real nearby city 3", "real nearby city 4"]
}

For serviceArea: list 4 real nearby cities/neighborhoods that people actually drive from to go to this gym. Use your knowledge of the area based on the gym's city.`;

  log(`  Calling LLM to generate homepage content (${spec.name} spec)...`);

  let generated: GeneratedHomeSlots | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await chatCompletion(
      { model: config.DEFAULT_LLM_MODEL, messages: [{ role: "user", content: prompt }], temperature: attempt === 1 ? 0.3 : 0 },
      config,
    );
    const jsonText = extractJsonObject(response.content ?? "");
    if (!jsonText) {
      log(`  [warn] attempt ${attempt}: LLM returned no JSON${attempt < 2 ? " — retrying" : ""}`);
      continue;
    }
    try {
      generated = JSON.parse(jsonText) as GeneratedHomeSlots;
      break;
    } catch {
      log(`  [warn] attempt ${attempt}: JSON parse failed${attempt < 2 ? " — retrying" : ""}`);
    }
  }

  if (!generated) {
    log(`  [warn] LLM failed after 2 attempts — using base content`);
    return baseContent;
  }

  log(`  LLM content generated ✓`);

  // Build merged home page content
  const baseHero = baseContent.pages.home.hero;
  const generatedHero: HeroContent = {
    headline: generated.hero?.headline || baseHero.headline,
    subheading: generated.hero?.subheading || baseHero.subheading,
    intro: generated.hero?.intro || baseHero.intro,
    ctaLabel: generated.hero?.ctaLabel || baseHero.ctaLabel || baseContent.business.primaryCta.label,
    ctaUrl: generated.hero?.ctaUrl || baseHero.ctaUrl || baseContent.business.primaryCta.url,
    backgroundImageUrl: heroImageUrl || baseHero.backgroundImageUrl,
  };

  const generatedValueProps: ValueProp[] = (generated.valueProps ?? [])
    .slice(0, 3)
    .map((v) => ({ icon: "star", headline: String(v.headline ?? ""), body: String(v.body ?? "") }));

  const generatedHowItWorks: Step[] = (generated.howItWorks ?? [])
    .slice(0, 3)
    .map((s, i) => ({ number: i + 1, headline: String(s.headline ?? ""), body: String(s.body ?? "") }));

  const generatedFeatures: Feature[] = (generated.features ?? [])
    .slice(0, 6)
    .map((f) => ({ icon: "star", label: String(f.label ?? "") }));

  // Use real testimonials from content artifact; fall back to base content-mapper testimonials
  const testimonials = existingTestimonials.length > 0
    ? existingTestimonials
    : baseContent.pages.home.testimonials;

  // Use real FAQ from content artifact; fall back to base
  const faq = existingFaq.length > 0
    ? existingFaq
    : baseContent.pages.home.faq;

  const generatedHome: HomeContent = {
    ...baseContent.pages.home,
    hero: generatedHero,
    valueProps: generatedValueProps.length > 0 ? generatedValueProps : baseContent.pages.home.valueProps,
    howItWorks: generatedHowItWorks.length > 0 ? generatedHowItWorks : baseContent.pages.home.howItWorks,
    howItWorksHeadline: generated.howItWorksHeadline || baseContent.pages.home.howItWorksHeadline,
    features: generatedFeatures.length > 0 ? generatedFeatures : baseContent.pages.home.features,
    communityHeadline: generated.communityHeadline || baseContent.pages.home.communityHeadline,
    trustHeadline: generated.trustHeadline || baseContent.pages.home.trustHeadline,
    testimonials,
    faq,
  };

  // Patch serviceArea into business if LLM provided real nearby cities
  const serviceArea = generated.serviceArea?.filter((c) => c && !c.toLowerCase().includes("city"))
    ?? baseContent.business.serviceArea;

  // Build navigation — prefer captured nav from original site (real labels + hierarchy),
  // fall back to inferring from crawl pages when nav-structure.json isn't available yet.
  const contentBriefs: Array<{ path: string; pageType: string }> = contentArtifact?.pages ?? [];
  const navigation = buildNavigation(crawlPages, contentBriefs, baseContent.pages.programs, capturedNav);

  log(`  Nav: ${navigation.header.map(i => i.label).join(", ")}`);

  return {
    ...baseContent,
    navigation,
    business: {
      ...baseContent.business,
      serviceArea: serviceArea?.length ? serviceArea : baseContent.business.serviceArea,
    },
    pages: {
      ...baseContent.pages,
      home: generatedHome,
    },
  };
}
