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
import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import type { GymSiteContent, HomeContent, HeroContent, ValueProp, Step, Feature, FAQItem, Testimonial, IframeEmbed } from "@ploy-gyms/shared-types";
import { buildNavigation } from "./nav-slots.js";
import {
  beanburitoSpec,
  buildSpecPrompt,
  validateIcon,
  resolveIcon,
  placeholderImage,
  inferIframeVariant,
  isAllowedIframeSrc,
  sanitizeIframe,
} from "@ploy-gyms/shared-types";
import { chatCompletion } from "../../ai/llm-client.js";
import { loadArtifact } from "../../utils/pipeline/artifact-store.js";
import type { MirrorAssetsArtifact } from "../../types/mirror.js";
import type { ExtractArtifact } from "../../types/pipeline-artifacts.js";
import { buildImageMatcher, makeRoundRobin } from "../mirror/image-matcher.js";

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
  valueProps: Array<{ headline: string; body: string; icon?: string }>;
  howItWorks: Array<{ headline: string; body: string }>;
  howItWorksHeadline: string;
  features: Array<{ label: string; icon?: string }>;
  communityHeadline: string;
  trustHeadline: string;
  ctaHeadline?: string;
  programsSubheadline?: string;
  ctaSubtext?: string;
  serviceArea?: string[];
  programs?: Array<{ slug?: string; name?: string; shortDescription: string }>;
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

interface ContentArtifactPage {
  path: string;
  pageType: string;
  purpose?: string;
  contentFound?: Record<string, unknown>;
  data?: Record<string, unknown>;
}
interface ContentArtifact {
  pages?: ContentArtifactPage[];
}

async function loadContentArtifact(db: Kysely<DB>, siteUuid: string): Promise<ContentArtifact | null> {
  const row = await db
    .selectFrom("pipelineArtifacts")
    .select("payload")
    .where("siteUuid", "=", siteUuid)
    .where("stage", "=", "content")
    .orderBy("version", "desc")
    .executeTakeFirst();
  const payload = row?.payload as ContentArtifact | undefined;
  return payload ?? null;
}

async function loadExtractArtifact(db: Kysely<DB>, siteUuid: string, workspaceUuid: string): Promise<ExtractArtifact | null> {
  const artifact = await loadArtifact<ExtractArtifact>(
    db,
    { siteUuid, workspaceUuid },
    "extract",
  ).catch(() => null);
  return artifact?.payload ?? null;
}

interface IframeConfigFile {
  iframes?: IframeEmbed[];
}

async function loadIframeConfig(
  s3Client: S3Client,
  bucket: string,
  siteUuid: string,
): Promise<IframeEmbed[]> {
  try {
    const obj = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: `sites/${siteUuid}/config/iframes.json`,
    }));
    const raw = await obj.Body?.transformToString() ?? "{}";
    const parsed = JSON.parse(raw) as IframeConfigFile;
    return Array.isArray(parsed.iframes) ? parsed.iframes : [];
  } catch {
    return [];
  }
}

/**
 * Turn raw crawled iframes into template embeds grouped by source page path.
 * We don't know the service, so we never hardcode third-party domains here.
 * We only apply a very loose URL-pattern hint to pick a default variant. A
 * human or the AI assistant can override variant/title/height/style in
 * sites/{uuid}/config/iframes.json.
 */
function iframesByPathFromExtract(extract: ExtractArtifact | null): Map<string, IframeEmbed[]> {
  const map = new Map<string, IframeEmbed[]>();
  if (!extract?.pages?.length) return map;
  for (const page of extract.pages) {
    const embeds = (page.content.iframes ?? [])
      .filter((f) => isAllowedIframeSrc(f.src))
      .map((f) => {
        const src = f.src;
        return sanitizeIframe({
          src,
          variant: inferIframeVariant(src),
          title: f.title,
          height: f.height,
          width: f.width,
          sandbox: f.sandbox,
          style: f.style,
          allow: f.allow,
          referrerpolicy: f.referrerpolicy,
          loading: f.loading,
        });
      });
    if (embeds.length > 0) {
      map.set(normalizePath(page.path), embeds);
    }
  }
  return map;
}

export function normalizePath(path: string): string {
  return path.replace(/\/$/, "") || "/";
}

export function matchExtractPath(path: string): "home" | "about" | "pricing" | "contact" | "schedule" | null {
  const normalized = normalizePath(path);
  if (normalized === "/") return "home";
  if (/^\/about/i.test(normalized)) return "about";
  if (/^\/contact/i.test(normalized)) return "contact";
  if (/^\/pricing/i.test(normalized) || /^\/membership/i.test(normalized) || /^\/join/i.test(normalized)) return "pricing";
  if (/^\/schedule/i.test(normalized) || /^\/classes/i.test(normalized) || /^\/book/i.test(normalized)) return "schedule";
  return null;
}

/**
 * Merge extracted per-page iframes into GymSiteContent pages, deduping by src
 * against iframes already placed by content-mapper or configured overrides.
 */
export function mergeExtractIframesIntoPages(
  pages: GymSiteContent["pages"],
  extractIframes: Map<string, IframeEmbed[]>,
): void {
  type IframeTarget = { page: { iframes?: IframeEmbed[] }; paths: string[] };
  const targets: IframeTarget[] = [
    { page: pages.home, paths: ["/"] },
    { page: pages.about, paths: ["/about"] },
    { page: pages.contact, paths: ["/contact"] },
    { page: pages.pricing, paths: ["/pricing", "/membership", "/join"] },
    { page: pages.schedule, paths: ["/schedule", "/classes", "/book"] },
    ...pages.programs.map((p) => ({
      page: p,
      paths: [`/programs/${p.slug}`, `/${p.slug}`],
    })),
  ];

  const seen = new Set<string>();
  for (const { page } of targets) {
    for (const e of page.iframes ?? []) seen.add(e.src);
  }

  for (const { page, paths } of targets) {
    const incoming: IframeEmbed[] = [];
    for (const path of paths) {
      const embeds = extractIframes.get(path);
      if (embeds) incoming.push(...embeds);
    }
    if (incoming.length === 0) continue;
    page.iframes = page.iframes ?? [];
    for (const e of incoming) {
      if (seen.has(e.src)) continue;
      seen.add(e.src);
      page.iframes.push(e);
    }
  }
}

// ── Icon / image helpers ───────────────────────────────────────────────────

/** List relative /_assets/ image paths from a mirror deploy prefix. */
async function listMirrorAssets(
  s3Client: S3Client,
  bucket: string,
  deployPrefix: string,
): Promise<string[]> {
  try {
    const result = await s3Client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: `${deployPrefix}/_assets/`,
    }));
    return (result.Contents ?? [])
      .map((obj) => obj.Key ?? "")
      .filter((key) => /\/_assets\/[^/]+\.(jpg|jpeg|png|webp|avif)$/i.test(key))
      .map((key) => key.replace(`${deployPrefix}/_assets/`, "/_assets/"))
      .sort();
  } catch {
    return [];
  }
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

function buildContextFromArtifact(artifact: ContentArtifact | null): string {
  if (!artifact?.pages?.length) return "";
  const lines: string[] = ["CONTENT FOUND ON THEIR WEBSITE:"];

  for (const page of artifact.pages) {
    const cf = (page.contentFound ?? page.data ?? {}) as Record<string, unknown>;
    const hero = (cf.hero ?? {}) as Record<string, unknown>;
    lines.push(`\nPage: ${page.path} (${page.pageType})`);
    if (page.purpose) lines.push(`  Purpose: ${page.purpose}`);
    if (hero.headline) lines.push(`  Hero headline: "${hero.headline}"`);
    if (hero.subheading) lines.push(`  Hero subheading: "${hero.subheading}"`);
    if (cf.body && String(cf.body).length > 20) lines.push(`  Body text: ${String(cf.body).slice(0, 600)}`);
    const testimonials = Array.isArray(cf.testimonials) ? cf.testimonials as Array<Record<string, unknown>> : [];
    if (testimonials.length > 0) {
      lines.push(`  Testimonials (${testimonials.length} found):`);
      for (const t of testimonials.slice(0, 5)) {
        lines.push(`    - "${t.quote}" — ${t.name}${t.program ? ` (${t.program})` : ""}`);
      }
    }
    const faq = Array.isArray(cf.faq) ? cf.faq as Array<Record<string, unknown>> : [];
    if (faq.length > 0) {
      lines.push(`  FAQ (${faq.length} found):`);
      for (const f of faq.slice(0, 7)) {
        lines.push(`    Q: ${f.question}`);
        lines.push(`    A: ${f.answer}`);
      }
    }
    const valueProps = Array.isArray(cf.valueProps) ? cf.valueProps as Array<Record<string, unknown>> : [];
    if (valueProps.length > 0) {
      lines.push(`  Value props found:`);
      for (const v of valueProps) lines.push(`    - ${v.headline}: ${v.body}`);
    }
  }
  return lines.join("\n");
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
  const extractArtifact = await loadExtractArtifact(db, siteUuid, workspaceUuid);

  // crawl pages no longer needed here — navigation built from capturedNav + contentBriefs

  // Load mirror deploy prefix so we can resolve hero image URLs
  const mirrorDeployArtifact = await db
    .selectFrom("pipelineArtifacts")
    .select("payload")
    .where("siteUuid", "=", siteUuid)
    .where("stage", "=", "mirror-deploy")
    .orderBy("version", "desc")
    .executeTakeFirst();
  const mirrorPayload = mirrorDeployArtifact?.payload as { deployPrefix?: string } | undefined;
  const mirrorDeployPrefix: string = mirrorPayload?.deployPrefix ?? "";

  // Load nav structure.
  // Priority:
  //   1. sites/{uuid}/config/nav-structure.json — stable, editable by admin/AI (never overwritten by clone)
  //   2. {deployPrefix}/nav-structure.json     — captured during last clone (seed source)
  // This means owners can edit the nav at any time without a re-clone.
  interface NavNode { label: string; href: string; children?: NavNode[]; }
  let capturedNav: NavNode[] = [];
  const bucket = input.config.S3_DEPLOYMENTS_BUCKET ?? input.config.S3_ASSETS_BUCKET;
  const configNavKey = `sites/${siteUuid}/config/nav-structure.json`;
  const configuredIframes = await loadIframeConfig(input.s3Client, bucket, siteUuid);

  let navSource = "none";
  try {
    const obj = await input.s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: configNavKey }));
    capturedNav = JSON.parse(await obj.Body?.transformToString() ?? "[]") as NavNode[];
    navSource = "config";
  } catch {
    // Config nav not yet set — fall back to deploy-prefix capture
    if (mirrorDeployPrefix) {
      try {
        const obj = await input.s3Client.send(new GetObjectCommand({
          Bucket: bucket,
          Key: `${mirrorDeployPrefix}/nav-structure.json`,
        }));
        capturedNav = JSON.parse(await obj.Body?.transformToString() ?? "[]") as NavNode[];
        navSource = "deploy-capture";
        // Seed the stable config path so future edits work without re-clone
        if (capturedNav.length > 0) {
          await input.s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: configNavKey,
            Body: Buffer.from(JSON.stringify(capturedNav, null, 2), "utf8"),
            ContentType: "application/json; charset=utf-8",
          }));
          log(`  Nav seeded to config from deploy capture`);
        }
      } catch { /* not yet captured — run clone */ }
    }
  }

  if (capturedNav.length > 0) {
    log(`  Nav [${navSource}]: ${capturedNav.map(i => i.label).join(", ")}`);
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

  // Build a pool of scraped gym photos for program covers and amenity backgrounds.
  // Exclude the hero image so it isn't reused as a generic box background.
  let mirrorAssets: string[] = [];
  if (mirrorDeployPrefix) {
    mirrorAssets = (await listMirrorAssets(input.s3Client, bucket, mirrorDeployPrefix))
      .filter((a) => a !== heroImageUrl)
      .sort();
    if (mirrorAssets.length > 0) {
      log(`  Mirror assets available: ${mirrorAssets.length}`);
    }
  }

  // Load the mirror-assets artifact for vision tags + section context.
  // Fall back to a plain S3 list if the artifact is missing (older captures).
  const assetsArtifact = await loadArtifact<MirrorAssetsArtifact>(db, { siteUuid, workspaceUuid }, "mirror-assets");
  const taggedAssets = assetsArtifact?.payload.assets ?? [];
  const imageMatcher = buildImageMatcher(taggedAssets);
  const hasVisionTags = taggedAssets.some((a) => a.visionTags && a.visionTags.length > 0);
  const fallbackPicker = makeRoundRobin(
    taggedAssets.length > 0 ? taggedAssets : mirrorAssets.map((localPath) => ({
      originalUrl: localPath,
      storageKey: "",
      localPath,
      contentType: "image/jpeg",
    })),
  );
  log(`  Image matcher ready: ${imageMatcher.photos.length} tagged photos (vision: ${hasVisionTags})`);

  // Get base GymSiteContent from content-mapper (handles brand, business NAP, nav, programs)
  log(`  Building base content from docs...`);
  const { buildGymJson } = await import("./content-mapper.js");
  const { content: baseContent, warnings: mapperWarnings } = await buildGymJson(
    db, siteUuid, { apiBaseUrl, siteUrl, googleMapsApiKey: config.GOOGLE_PLACES_API_KEY }, workspaceUuid,
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
  const homePage = contentArtifact?.pages?.find((p) => p.path === "/");
  const homeCf = (homePage?.contentFound ?? homePage?.data ?? {}) as Record<string, unknown>;
  const artifactHero = homeCf.hero as Record<string, unknown> | undefined;
  const homeTestimonials = Array.isArray(homeCf.testimonials) ? homeCf.testimonials as Array<Record<string, unknown>> : [];
  const homeFaq = Array.isArray(homeCf.faq) ? homeCf.faq as Array<Record<string, unknown>> : [];
  const existingTestimonials: Testimonial[] = homeTestimonials
    .filter((t) => t.quote && t.name)
    .map((t) => ({ quote: String(t.quote), name: String(t.name), program: t.program ? String(t.program) : undefined }));
  const existingFaq: FAQItem[] = homeFaq
    .filter((f) => f.question && f.answer)
    .map((f) => ({ question: String(f.question), answer: String(f.answer) }));

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
    { "headline": "string (2-5 words)", "body": "string (15-25 words)", "icon": "string (Phosphor bold icon name, kebab-case, e.g. barbell, users, target)" },
    { "headline": "string", "body": "string", "icon": "string" },
    { "headline": "string", "body": "string", "icon": "string" }
  ],
  "howItWorks": [
    { "headline": "string (step name, 2-5 words)", "body": "string (15-25 words)" },
    { "headline": "string", "body": "string" },
    { "headline": "string", "body": "string" }
  ],
  "howItWorksHeadline": "string (4-7 words)",
  "features": [
    { "label": "string (2-4 words)", "icon": "string (Phosphor bold icon name, e.g. clock, car, drop, barbell)" },
    { "label": "string", "icon": "string" },
    { "label": "string", "icon": "string" },
    { "label": "string", "icon": "string" },
    { "label": "string", "icon": "string" },
    { "label": "string", "icon": "string" }
  ],
  "communityHeadline": "string (4-8 words, emotional, about belonging)",
  "trustHeadline": "string (5-10 words, social proof for testimonials section)",
  "ctaHeadline": "string (4-8 words, action-oriented bottom CTA headline; can echo the hero outcome)",
  "programsSubheadline": "string (6-10 words, supporting the programs headline)",
  "ctaSubtext": "string (8-12 words, friction-reducing line under the bottom CTA headline)",
  "serviceArea": ["real nearby city 1", "real nearby city 2", "real nearby city 3", "real nearby city 4"],
  "programs": [
    { "slug": "group-strength", "shortDescription": "string (10-20 words, specific to group strength)" },
    { "slug": "cardio-bootcamp", "shortDescription": "string (10-20 words, specific to cardio/bootcamp)" },
    { "slug": "personal-training", "shortDescription": "string (10-20 words, specific to personal training)" }
  ]
}

Guidance for programs.shortDescription: write a distinct, concrete line for each program. Mention the format (barbell, intervals, 1-on-1), the outcome, and who it's for. Do NOT repeat the same sentence structure across all three.

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
  const heroContext = `hero ${generated.hero?.headline ?? baseHero.headline} ${generated.hero?.subheading ?? baseHero.subheading ?? ""} ${baseContent.business.name}`.trim();
  const matchedHeroImage = !heroImageUrl
    ? imageMatcher.match({ query: heroContext, preferredSectionType: "hero" })
    : undefined;
  const generatedHero: HeroContent = {
    headline: generated.hero?.headline || baseHero.headline,
    subheading: generated.hero?.subheading || baseHero.subheading,
    intro: generated.hero?.intro || baseHero.intro,
    ctaLabel: generated.hero?.ctaLabel || baseHero.ctaLabel || baseContent.business.primaryCta.label,
    ctaUrl: generated.hero?.ctaUrl || baseHero.ctaUrl || baseContent.business.primaryCta.url,
    backgroundImageUrl: heroImageUrl || matchedHeroImage || baseHero.backgroundImageUrl,
  };

  const generatedValueProps: ValueProp[] = (generated.valueProps ?? [])
    .slice(0, 3)
    .map((v) => ({
      icon: validateIcon(v.icon ?? "") === "star" ? resolveIcon(v.headline) : validateIcon(v.icon ?? ""),
      headline: String(v.headline ?? ""),
      body: String(v.body ?? ""),
    }));

  const generatedHowItWorks: Step[] = (generated.howItWorks ?? [])
    .slice(0, 3)
    .map((s, i) => ({ number: i + 1, headline: String(s.headline ?? ""), body: String(s.body ?? "") }));

  const usedFeatureImages = new Set<string>();
  const generatedFeatures: Feature[] = (generated.features ?? [])
    .slice(0, 6)
    .map((f, i) => {
      const query = `${f.label ?? ""} ${i < 3 ? "amenity facility" : "feature service"}`.trim();
      const matched = imageMatcher.match({
        query,
        exclude: usedFeatureImages,
        preferredSectionType: "feature-grid",
      });
      const imageUrl = matched
        ?? (hasVisionTags ? placeholderImage(String(f.label ?? "Feature"), 800, 600) : fallbackPicker(usedFeatureImages))
        ?? "";
      if (imageUrl) usedFeatureImages.add(imageUrl);
      return {
        icon: validateIcon(f.icon ?? "") === "star" ? resolveIcon(f.label) : validateIcon(f.icon ?? ""),
        label: String(f.label ?? ""),
        imageUrl,
      };
    });

  // Use real testimonials from content artifact; fall back to base content-mapper testimonials
  const testimonials = existingTestimonials.length > 0
    ? existingTestimonials
    : baseContent.pages.home.testimonials;

  // Use real FAQ from content artifact; fall back to base
  const faq = existingFaq.length > 0
    ? existingFaq
    : baseContent.pages.home.faq;

  // Prefer real hero copy captured from the source site over LLM-generated defaults.
  const finalHero: HeroContent = {
    ...generatedHero,
    headline: artifactHero?.headline ? String(artifactHero.headline) : generatedHero.headline,
    subheading: artifactHero?.subheading ? String(artifactHero.subheading) : generatedHero.subheading,
    intro: artifactHero?.intro
      ? String(artifactHero.intro)
      : (baseContent.pages.home.hero.intro ?? generatedHero.intro ?? ""),
  };
  // Drop generic "Welcome to ... premier ..." intros that the LLM tends to invent.
  if (/welcome to.*premier.*facility/i.test(finalHero.intro ?? "")) {
    finalHero.intro = "";
  }

  // Merge iframe widgets discovered by the extract stage into every page, not
  // just the home page. Configured overrides stay as the home-page source of truth.
  const extractIframes = iframesByPathFromExtract(extractArtifact);
  const safeConfiguredIframes = configuredIframes
    .filter((e) => isAllowedIframeSrc(e.src))
    .map(sanitizeIframe);

  const existingHomeIframes = (baseContent.pages.home.iframes ?? [])
    .filter((e) => isAllowedIframeSrc(e.src))
    .map(sanitizeIframe);
  const seenConfiguredSrc = new Set(safeConfiguredIframes.map((e) => e.src));
  baseContent.pages.home.iframes = [
    ...safeConfiguredIframes,
    ...existingHomeIframes.filter((e) => !seenConfiguredSrc.has(e.src)),
  ];
  if (baseContent.pages.home.iframes.length === 0) {
    baseContent.pages.home.iframes = undefined;
  }

  mergeExtractIframesIntoPages(baseContent.pages, extractIframes);

  const allIframes: IframeEmbed[] = [
    ...(baseContent.pages.home.iframes ?? []),
    ...baseContent.pages.programs.flatMap((p) => p.iframes ?? []),
    ...(baseContent.pages.about.iframes ?? []),
    ...(baseContent.pages.pricing.iframes ?? []),
    ...(baseContent.pages.contact.iframes ?? []),
    ...(baseContent.pages.schedule.iframes ?? []),
  ];
  if (allIframes.length > 0) {
    log(`  Iframes: ${allIframes.map((e) => `${e.variant ?? "default"} (${e.src})`).join(", ")}`);
  }

  const generatedHome: HomeContent = {
    ...baseContent.pages.home,
    hero: finalHero,
    valueProps: generatedValueProps.length > 0 ? generatedValueProps : baseContent.pages.home.valueProps,
    howItWorks: generatedHowItWorks.length > 0 ? generatedHowItWorks : baseContent.pages.home.howItWorks,
    howItWorksHeadline: generated.howItWorksHeadline || baseContent.pages.home.howItWorksHeadline,
    features: generatedFeatures.length > 0 ? generatedFeatures : baseContent.pages.home.features,
    communityHeadline: generated.communityHeadline || baseContent.pages.home.communityHeadline,
    trustHeadline: generated.trustHeadline || baseContent.pages.home.trustHeadline,
    ctaHeadline: generated.ctaHeadline || generated.trustHeadline || baseContent.pages.home.ctaHeadline || baseContent.pages.home.trustHeadline,
    programsSubheadline: generated.programsSubheadline || baseContent.pages.home.programsSubheadline,
    ctaSubtext: generated.ctaSubtext || baseContent.pages.home.ctaSubtext,
    testimonials,
    faq,
    iframes: baseContent.pages.home.iframes,
  };

  // Patch serviceArea into business if LLM provided real nearby cities
  const serviceArea = generated.serviceArea?.filter((c) => c && !c.toLowerCase().includes("city"))
    ?? baseContent.business.serviceArea;

  // Build navigation — prefer captured nav from original site (real labels + hierarchy),
  // fall back to inferring from crawl pages when nav-structure.json isn't available yet.
  const contentBriefs: Array<{ path: string; pageType: string }> = contentArtifact?.pages ?? [];
  const navigation = buildNavigation(capturedNav, baseContent.pages.programs, contentBriefs);

  log(`  Nav: ${navigation.header.map(i => i.label).join(", ")}`);

  // Merge generated per-program descriptions into program pages.
  const programsBySlug = new Map(
    (generated.programs ?? []).map((p) => [p.slug ?? p.name?.toLowerCase().replace(/\s+/g, "-") ?? "", p]),
  );

  // Assign scraped gym photos to each program page and cover by matching
  // the program's topic against vision tags + source-section context.
  const usedProgramImages = new Set<string>();
  const mergedPrograms = baseContent.pages.programs.map((p) => {
    const generatedDesc = programsBySlug.get(p.slug)?.shortDescription;
    const programContext = `${p.name} ${p.shortDescription ?? ""} ${generatedDesc ?? ""} program workout`.trim();
    const matched = imageMatcher.match({
      query: programContext,
      exclude: usedProgramImages,
      preferredSectionType: "feature-grid",
    });
    const coverImageUrl = matched
      ?? (hasVisionTags ? placeholderImage(p.name, 800, 600) : fallbackPicker(usedProgramImages))
      ?? p.coverImageUrl;
    if (coverImageUrl) usedProgramImages.add(coverImageUrl);
    const next: typeof p = {
      ...p,
      coverImageUrl,
      hero: {
        ...p.hero,
        backgroundImageUrl: coverImageUrl,
      },
    };
    return generatedDesc
      ? { ...next, shortDescription: String(generatedDesc).slice(0, 160) }
      : next;
  });

  const mergedContent: GymSiteContent = {
    ...baseContent,
    navigation,
    business: {
      ...baseContent.business,
      serviceArea: serviceArea?.length ? serviceArea : baseContent.business.serviceArea,
    },
    pages: {
      ...baseContent.pages,
      home: generatedHome,
      programs: mergedPrograms,
    },
  };

  // LLM-generated or source-captured CTAs may point to pages that won't be rendered.
  // Sanitize after all merges so every internal CTA is guaranteed valid.
  const { sanitizeContentCtas } = await import("./content-mapper.js");
  sanitizeContentCtas(mergedContent.pages, mergedContent.business, []);

  return mergedContent;
}
