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
import type { GymSiteContent, HomeContent, HeroContent, ValueProp, Step, Feature, FAQItem, Testimonial, IframeEmbed, ProgramContent, AboutContent, TemplateSpec, PageSpec, PageBrief, ContentArtifact } from "@milo/shared-types";
import { NO_IMAGE } from "@milo/shared-types";
import { buildNavigation } from "./nav-slots.js";
import {
  getTemplateSpec,
  buildSpecPrompt,
  buildPageSpecPrompt,
  validateIcon,
  resolveIcon,
  placeholderImage,
  inferIframeVariant,
  isAllowedIframeSrc,
  sanitizeIframe,
} from "@milo/shared-types";
import { chatCompletion } from "../../ai/llm-client.js";
import { loadArtifact } from "../../utils/pipeline/artifact-store.js";
import type { MirrorAssetsArtifact } from "../../types/mirror.js";
import type { ExtractArtifact } from "../../types/pipeline-artifacts.js";
import type { SiteHierarchy } from "../../types/site-hierarchy.js";
import { mergeGeneratedAboutContent } from "./content-mapper.js";
import { buildImageMatcher, makeRoundRobin } from "../mirror/image-matcher.js";
import { sanitizeHtml, sanitizeContentBlocks } from "@milo/shared-types";
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

/** Raw LLM output for a single program page. */
interface GeneratedProgramPage {
  slug: string;
  hero?: {
    subheading?: string;
    headline?: string;
    intro?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  };
  whatIsIt?: { headline?: string; body?: string };
  whatMakesUsDifferent?: string[];
  whatToExpect?: { headline?: string; steps?: string[] };
  whoIsItFor?: string[];
  gettingStarted?: Array<{ headline: string; body: string }>;
  testimonials?: Array<{ quote: string; name: string; program?: string }>;
  faq?: Array<{ question: string; answer: string }>;
}

/** Raw LLM output for the about page. */
interface GeneratedAboutPage {
  hero?: {
    subheading?: string;
    headline?: string;
    intro?: string;
    ctaLabel?: string;
    ctaUrl?: string;
  };
  story?: {
    headline?: string;
    subheadline?: string;
    imageUrl?: string;
    imageAlt?: string;
    blocks?: Array<{ type?: string; html?: string }>;
  };
  community?: { headline?: string; body?: string };
  team?: { headline?: string; members?: Array<{ name?: string; title?: string; photoUrl?: string; bio?: string }> };
  testimonials?: { headline?: string; items?: Array<{ quote?: string; name?: string; program?: string }> };
  ctaBand?: { headline?: string; ctaLabel?: string; ctaUrl?: string };
  faq?: Array<{ question?: string; answer?: string }>;
  location?: { headline?: string; body?: string };
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

  for (const { page, paths } of targets) {
    const seen = new Set((page.iframes ?? []).map((e) => e.src));
    const incoming: IframeEmbed[] = [];
    for (const path of paths) {
      for (const e of extractIframes.get(path) ?? []) {
        if (seen.has(e.src)) continue;
        seen.add(e.src);
        incoming.push(e);
      }
    }
    if (incoming.length === 0) continue;
    page.iframes = [...(page.iframes ?? []), ...incoming];
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
    const cf = page.contentFound;
    const hero = cf.hero;
    lines.push(`\nPage: ${page.path} (${page.pageType})`);
    if (page.purpose) lines.push(`  Purpose: ${page.purpose}`);
    if (hero.headline) lines.push(`  Hero headline: "${hero.headline}"`);
    if (hero.subheading) lines.push(`  Hero subheading: "${hero.subheading}"`);
    if (cf.body && String(cf.body).length > 20) lines.push(`  Body text: ${String(cf.body).slice(0, 600)}`);
    if (cf.shortDescription) lines.push(`  Short description: ${cf.shortDescription}`);
    if (cf.whoIsItFor?.length) {
      lines.push(`  Who it's for:`);
      for (const item of cf.whoIsItFor.slice(0, 5)) lines.push(`    - ${item}`);
    }
    if (cf.whatMakesUsDifferent?.length) {
      lines.push(`  What makes it different:`);
      for (const item of cf.whatMakesUsDifferent.slice(0, 5)) lines.push(`    - ${item}`);
    }
    const testimonials = cf.testimonials ?? [];
    if (testimonials.length > 0) {
      lines.push(`  Testimonials (${testimonials.length} found):`);
      for (const t of testimonials.slice(0, 5)) {
        lines.push(`    - "${t.quote}" — ${t.name}${t.program ? ` (${t.program})` : ""}`);
      }
    }
    const faq = cf.faq ?? [];
    if (faq.length > 0) {
      lines.push(`  FAQ (${faq.length} found):`);
      for (const f of faq.slice(0, 7)) {
        lines.push(`    Q: ${f.question}`);
        lines.push(`    A: ${f.answer}`);
      }
    }
    const valueProps = cf.valueProps ?? [];
    if (valueProps.length > 0) {
      lines.push(`  Value props found:`);
      for (const v of valueProps) lines.push(`    - ${v.headline}: ${v.body}`);
    }
  }
  return lines.join("\n");
}

/** Find the content-stage brief for a program page by slug. */
function findProgramBrief(artifact: ContentArtifact | null, slug: string): PageBrief | undefined {
  if (!artifact?.pages?.length) return undefined;
  const programPath = `/programs/${slug}`;
  return artifact.pages.find((p) => normalizePath(p.path) === programPath || normalizePath(p.path) === `/${slug}`);
}

/** Build a concise context string from a single program brief. */
function buildProgramBriefContext(brief: PageBrief): string {
  const cf = brief.contentFound;
  const lines: string[] = [];
  lines.push(`Original page: ${brief.path} (${brief.purpose || brief.pageType})`);
  if (cf.hero.headline) lines.push(`Hero headline: "${cf.hero.headline}"`);
  if (cf.hero.subheading) lines.push(`Hero subheading: "${cf.hero.subheading}"`);
  if (cf.body?.length > 20) lines.push(`Body text: ${cf.body.slice(0, 800)}`);
  if (cf.shortDescription) lines.push(`Short description: ${cf.shortDescription}`);
  if (cf.whoIsItFor?.length) {
    lines.push("Who it's for (from source site):");
    for (const item of cf.whoIsItFor) lines.push(`  - ${item}`);
  }
  if (cf.whatMakesUsDifferent?.length) {
    lines.push("What makes it different (from source site):");
    for (const item of cf.whatMakesUsDifferent) lines.push(`  - ${item}`);
  }
  if (cf.testimonials?.length) {
    lines.push(`Testimonials found (${cf.testimonials.length}):`);
    for (const t of cf.testimonials.slice(0, 3)) lines.push(`  - "${t.quote}" — ${t.name}`);
  }
  if (cf.faq?.length) {
    lines.push(`FAQ found (${cf.faq.length}):`);
    for (const f of cf.faq.slice(0, 5)) {
      lines.push(`  Q: ${f.question}`);
      lines.push(`  A: ${f.answer}`);
    }
  }
  return lines.join("\n");
}

/** Pull the ## Site playbook section from site-strategy, or derive a minimal one. Exported for testing. */
export function buildSitePlaybook(siteStrategy: string, workspaceMemory: string, businessInfo: string): string {
  const playbookMatch = siteStrategy.match(/## Site playbook[\s\S]*?(?=\n## |$)/);
  if (playbookMatch) {
    const trimmed = playbookMatch[0].trim();
    if (trimmed.length > 80) return trimmed;
  }

  // Fallback: derive a minimal playbook from workspace memory and business info.
  const lines: string[] = [
    "## Site playbook",
    "",
    "### Conversion goal",
    "",
    "- Drive the primary conversion action on every page.",
    "",
    "### Ideal first action",
    "",
    "- Book a free intro or tour",
    "",
    "### Offer / hook",
    "",
    "- Free intro or trial class",
    "",
    "### Voice rules",
    "",
    "- Use sentence case for buttons, labels, and body copy.",
    "- Mention the gym name and city naturally, at most once per section.",
    "- Never promise specific results or invent prices, schedules, or guarantees.",
    "- Every page should end with one clear call to action.",
  ];

  // Try to extract a brand voice line from workspace memory.
  const voiceMatch = workspaceMemory.match(/### Brand voice\s*\n\s*-\s*(.+)/);
  if (voiceMatch?.[1]) {
    lines.push(`- ${voiceMatch[1].trim()}`);
  }

  // Try to extract conversion signals from business-info doc.
  const primaryCta = businessInfo.match(/\*\*Primary CTA\*\*:\s*(.+)/)?.[1]?.trim();
  const offer = businessInfo.match(/\*\*Offer\*\*:\s*(.+)/)?.[1]?.trim();
  const signupMethod = businessInfo.match(/\*\*How to sign up\*\*:\s*(.+)/)?.[1]?.trim();
  if (primaryCta || offer || signupMethod) {
    lines.push(
      "",
      "### Conversion signals from business info",
      "",
      primaryCta ? `- Primary CTA: ${primaryCta}` : "",
      offer ? `- Offer: ${offer}` : "",
      signupMethod ? `- How to sign up: ${signupMethod}` : "",
    );
  }

  return lines.filter(Boolean).join("\n");
}

/** Build a compact conversion brief for a page from its PageSpec. Exported for testing. */
export function buildConversionBrief(pageSpec: PageSpec): string {
  const lines: string[] = [];
  if (pageSpec.goal) lines.push(`PAGE GOAL: ${pageSpec.goal}`);
  if (pageSpec.idealAction) lines.push(`IDEAL ACTION: ${pageSpec.idealAction}`);
  if (pageSpec.visitorStage) lines.push(`VISITOR STAGE: ${pageSpec.visitorStage}`);
  if (pageSpec.searchIntent) lines.push(`SEARCH INTENT: ${pageSpec.searchIntent}`);
  if (pageSpec.objectionsToOvercome?.length) {
    lines.push(`OBJECTIONS TO OVERCOME: ${pageSpec.objectionsToOvercome.join("; ")}`);
  }
  if (pageSpec.evidenceTypes?.length) {
    lines.push(`EVIDENCE TO USE: ${pageSpec.evidenceTypes.join(", ")}`);
  }
  if (pageSpec.seoPrimaryQuery) lines.push(`SEO PRIMARY QUERY: ${pageSpec.seoPrimaryQuery}`);
  return lines.join("\n");
}

/** Find the content-stage brief for the about page. */
function findAboutBrief(artifact: ContentArtifact | null): PageBrief | undefined {
  return artifact?.pages?.find((p) => matchExtractPath(p.path) === "about");
}

/** Build a concise context string from the about-page brief. */
function buildAboutBriefContext(brief: PageBrief | undefined): string {
  if (!brief) return "(no extracted content found for the about page)";
  const cf = brief.contentFound;
  const lines: string[] = [];
  lines.push(`Original page: ${brief.path} (${brief.purpose || brief.pageType})`);
  if (cf.hero.headline) lines.push(`Hero headline: "${cf.hero.headline}"`);
  if (cf.hero.subheading) lines.push(`Hero subheading: "${cf.hero.subheading}"`);
  if (cf.gymStory) lines.push(`Gym story: ${cf.gymStory.slice(0, 800)}`);
  if (cf.body?.length > 20) lines.push(`Body text: ${cf.body.slice(0, 800)}`);
  if (cf.team?.length) {
    lines.push(`Team members found (${cf.team.length}):`);
    for (const t of cf.team.slice(0, 5)) lines.push(`  - ${t.name}${t.title ? `, ${t.title}` : ""}`);
  }
  if (cf.testimonials?.length) {
    lines.push(`Testimonials found (${cf.testimonials.length}):`);
    for (const t of cf.testimonials.slice(0, 3)) lines.push(`  - "${t.quote}" — ${t.name}`);
  }
  return lines.join("\\n");
}

/** Build a spec-driven prompt for a single program page. */
function buildProgramPrompt(ctx: {
  spec: TemplateSpec;
  program: ProgramContent;
  brief?: PageBrief;
  businessInfo: string;
  brandGuidelines: string;
  siteStrategy: string;
  siteHierarchy: string;
  artifactContext: string;
  sitePlaybook: string;
  conversionBrief: string;
}): string {
  const { spec, program, brief, businessInfo, brandGuidelines, siteStrategy, siteHierarchy, artifactContext, sitePlaybook, conversionBrief } = ctx;
  const programSpecPrompt = buildPageSpecPrompt(spec, "program");
  const briefContext = brief ? buildProgramBriefContext(brief) : "(no extracted content found for this program page)";

  return `You are writing content for a specific program page on a gym website. Use ONLY the gym's real information from the docs below. Be specific, but never invent facts.

## PROGRAM

Slug: ${program.slug}
Name: ${program.name}
Current short description: ${program.shortDescription || "(none)"}

## GYM DOCS

### Business Info
${businessInfo || "(not available)"}

### Brand & Voice Guidelines
${(brandGuidelines || "").slice(0, 600)}

### Site Playbook
${sitePlaybook.slice(0, 1200)}

### Marketing Strategy
${(siteStrategy || "").slice(0, 500)}

### Site Structure
${siteHierarchy ? siteHierarchy.slice(0, 1200) : "(not available)"}

### Content found on the original website
${artifactContext ? artifactContext.slice(0, 1200) : ""}

### Content found on the original program page
${briefContext.slice(0, 1500)}

---

## CONVERSION BRIEF FOR THIS PAGE

${conversionBrief || "Write program page content that drives a free-trial or class booking."}

---

## YOUR TASK

${programSpecPrompt}

---

## HARD RULES

- Only state specific facts (class times, prices, durations, exact coach names, equipment lists, class capacities, attendance limits) if they appear in the gym docs or extracted page content above.
- If a specific fact is unknown, describe the program in general terms or omit the field. NEVER invent hours, prices, schedules, numbers, or guarantees.
- For schedules/timing, use language like "classes run throughout the week" or "check the live schedule" unless exact times are documented.
- Keep every field within the max word count in the spec.

---

## OUTPUT FORMAT

Return ONLY valid JSON with this exact shape. No markdown, no explanation:

{
  "hero": {
    "subheading": "string (3-5 words, ALL-CAPS label)",
    "headline": "string (4-8 words, bold outcome for this program)",
    "intro": "string (1-2 sentences, specific to this program)",
    "ctaLabel": "string (2-4 words, action button)",
    "ctaUrl": "string (use /contact if unknown)"
  },
  "whatIsIt": {
    "headline": "string (4-6 words)",
    "body": "string (2-3 sentences, max 80 words)"
  },
  "whatMakesUsDifferent": [
    "string (8-16 words)",
    "string (8-16 words)",
    "string (8-16 words)"
  ],
  "whatToExpect": {
    "headline": "string (4-6 words)",
    "steps": [
      "string (8-16 words)",
      "string (8-16 words)",
      "string (8-16 words)"
    ]
  },
  "whoIsItFor": [
    "string (6-14 words)",
    "string (6-14 words)",
    "string (6-14 words)"
  ],
  "gettingStarted": [
    { "headline": "string (step name, 2-5 words)", "body": "string (12-20 words)" },
    { "headline": "string", "body": "string" },
    { "headline": "string", "body": "string" }
  ],
  "testimonials": [
    { "quote": "string", "name": "string" }
  ],
  "faq": [
    { "question": "string (long-tail local search question)", "answer": "string (1-3 sentences)" },
    ... exactly 10 items
  ]
}

Guidance for testimonials: use the extracted page content above when available. If none is documented, return an empty array. Never invent member names or fake quotes.

Guidance for FAQ: generate exactly 10 questions and answers. Each question should read like a real long-tail local search query and be unique to this program page. Bias toward local intent: "[program] near me in [city]", "what to expect at [program] in [city]", "is [program] good for beginners in [city]", "[program] vs CrossFit in [city]", "how much does [program] cost in [city]", "what do I need for [program] in [neighborhood]". Use the gym's real city and nearby neighborhoods from the docs. Only answer with documented facts; if a specific detail is unknown, give honest general guidance and invite the visitor to ask. Do not keyword-stuff. Each answer must be distinct.`;
}

/** Build a spec-driven prompt for the about page. */
function buildAboutPrompt(ctx: {
  spec: TemplateSpec;
  businessInfo: string;
  brandGuidelines: string;
  siteStrategy: string;
  siteHierarchy: string;
  artifactContext: string;
  briefContext: string;
  sitePlaybook: string;
  conversionBrief: string;
}): string {
  const { spec, businessInfo, brandGuidelines, siteStrategy, siteHierarchy, artifactContext, briefContext, sitePlaybook, conversionBrief } = ctx;
  const aboutSpecPrompt = buildPageSpecPrompt(spec, "about");

  return `You are writing content for the About page of a gym website. Use ONLY the gym's real information from the docs below. Be specific, but never invent facts.

## GYM DOCS

### Business Info
${businessInfo || "(not available)"}

### Brand & Voice Guidelines
${(brandGuidelines || "").slice(0, 600)}

### Site Playbook
${sitePlaybook.slice(0, 1200)}

### Marketing Strategy
${(siteStrategy || "").slice(0, 500)}

### Site Structure
${siteHierarchy ? siteHierarchy.slice(0, 1200) : "(not available)"}

### Content found on the original website
${artifactContext ? artifactContext.slice(0, 1200) : ""}

### Content found on the original about page
${briefContext.slice(0, 1500)}

---

## CONVERSION BRIEF FOR THIS PAGE

${conversionBrief || "Write about-page content that earns trust and drives a free intro or visit."}

---

## YOUR TASK

${aboutSpecPrompt}

---

## HARD RULES

- Only state specific facts (founding year, coach names, credentials, member count, location history) if they appear in the gym docs or extracted page content above.
- If a specific fact is unknown, describe the gym's identity in general terms or omit the field. NEVER invent years, prices, schedules, numbers, or guarantees.
- Keep every field within the max word count in the spec.
- For team members, only include people documented in the gym docs. Do not invent coaches.

---

## OUTPUT FORMAT

Return ONLY valid JSON with this exact shape. No markdown, no explanation:

{
  "hero": {
    "subheading": "string (3-5 words, ALL-CAPS label)",
    "headline": "string (4-8 words, bold identity statement)",
    "intro": "string (1-2 sentences, specific proof point)",
    "ctaLabel": "string (2-4 words, action button)",
    "ctaUrl": "string (use /contact if unknown)"
  },
  "story": {
    "headline": "string (4-8 words)",
    "subheadline": "string (1 sentence)",
    "imageUrl": "string (real image path or empty)",
    "imageAlt": "string",
    "blocks": [
      { "type": "text", "html": "string (paragraph)" }
    ]
  },
  "community": {
    "headline": "string (4-8 words)",
    "body": "string (2-4 paragraphs, HTML)"
  },
  "team": {
    "headline": "string (4-8 words)",
    "members": [
      { "name": "string", "title": "string", "photoUrl": "string or empty", "bio": "string (optional)" }
    ]
  },
  "testimonials": {
    "headline": "string (5-10 words)",
    "items": [
      { "quote": "string", "name": "string" }
    ]
  },
  "ctaBand": {
    "headline": "string (4-8 words, action-oriented)",
    "ctaLabel": "string (2-4 words)",
    "ctaUrl": "string (use /contact if unknown)"
  },
  "faq": [
    { "question": "string (long-tail local search question)", "answer": "string (1-3 sentences)" },
    ... exactly 10 items
  ],
  "location": {
    "headline": "string (4-8 words)",
    "body": "string (1-2 sentences)"
  }
}

Guidance for FAQ: generate exactly 10 questions and answers. Each question should be a realistic long-tail search query about this gym: "about [Gym] in [city]", "who owns [Gym] in [city]", "[Gym] reviews [city]", "what makes [Gym] different", "is [Gym] good for beginners in [city]", "where is [Gym] located in [neighborhood]". Use only documented facts; invite contact for unknowns.

Guidance for testimonials: use the extracted about page content above when available. If none is documented, return an empty items array. Never invent member names or fake quotes.`;
}

/** Build a prompt that generates 10 long-tail local SEO FAQs for any page archetype. */
function buildPageFaqPrompt(ctx: {
  spec: TemplateSpec;
  pageKey: string;
  pageTitle: string;
  pagePath: string;
  existingFaq: FAQItem[];
  businessInfo: string;
  brandGuidelines: string;
  siteStrategy: string;
  siteHierarchy: string;
  artifactContext: string;
  sitePlaybook: string;
  conversionBrief: string;
}): string {
  const { spec, pageKey, pageTitle, pagePath, existingFaq, businessInfo, brandGuidelines, siteStrategy, siteHierarchy, artifactContext, sitePlaybook, conversionBrief } = ctx;
  const faqSpecPrompt = buildPageSpecPrompt(spec, "faq");
  const existingLines = existingFaq.length
    ? existingFaq.map((f) => `Q: ${f.question}\nA: ${f.answer}`).join("\n")
    : "(no FAQ extracted for this page)";

  return `You are writing 10 FAQ items for the "${pageTitle}" page (${pagePath}) on a gym website. These FAQs must be unique to this page and biased toward long-tail local search queries that someone in the gym's area would actually type.

## PAGE

Page: ${pageTitle}
Path: ${pagePath}
Archetype: ${pageKey}

## GYM DOCS

### Business Info
${businessInfo || "(not available)"}

### Brand & Voice Guidelines
${(brandGuidelines || "").slice(0, 600)}

### Site Playbook
${sitePlaybook.slice(0, 1200)}

### Marketing Strategy
${(siteStrategy || "").slice(0, 500)}

### Site Structure
${siteHierarchy ? siteHierarchy.slice(0, 1200) : "(not available)"}

### Content found on the original website
${artifactContext ? artifactContext.slice(0, 1200) : ""}

### FAQ already extracted from this page
${existingLines.slice(0, 1500)}

---

## CONVERSION BRIEF FOR THIS PAGE

${conversionBrief || "Write FAQ content that answers real local search questions and invites the visitor to take the next step."}

---

## YOUR TASK

${faqSpecPrompt}

---

## HARD RULES

- Generate exactly 10 question/answer pairs.
- Each question must be a realistic long-tail search query tied to this page topic and the gym's city/neighborhoods.
- Only state documented facts. If a specific is unknown, give honest general guidance and invite the visitor to contact the gym.
- Do not invent prices, schedules, guarantees, or membership terms.
- Keep answers to 1-3 sentences.
- Mention the gym name and city naturally at most once per answer.

---

## OUTPUT FORMAT

Return ONLY valid JSON with this exact shape. No markdown, no explanation:

{
  "faq": [
    { "question": "string", "answer": "string" },
    ... exactly 10 items
  ]
}`;
}

async function generatePageFaq(ctx: {
  config: Config;
  spec: TemplateSpec;
  pageKey: string;
  pageTitle: string;
  pagePath: string;
  existingFaq: FAQItem[];
  businessInfo: string;
  brandGuidelines: string;
  siteStrategy: string;
  siteHierarchy: string;
  artifactContext: string;
  sitePlaybook: string;
  conversionBrief: string;
  log: (msg: string) => void;
}): Promise<FAQItem[] | null> {
  const { config, log, ...promptCtx } = ctx;
  const prompt = buildPageFaqPrompt(promptCtx);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await chatCompletion(
      { model: config.DEFAULT_LLM_MODEL, messages: [{ role: "user", content: prompt }], temperature: attempt === 1 ? 0.3 : 0 },
      config,
    );
    const jsonText = extractJsonObject(response.content ?? "");
    if (!jsonText) {
      log(`  [warn] ${promptCtx.pageKey} FAQ attempt ${attempt}: LLM returned no JSON${attempt < 2 ? " — retrying" : ""}`);
      continue;
    }
    try {
      const parsed = JSON.parse(jsonText) as { faq?: FAQItem[] };
      const faq = (parsed.faq ?? []).filter((f) => f.question && f.answer);
      return faq;
    } catch {
      log(`  [warn] ${promptCtx.pageKey} FAQ attempt ${attempt}: JSON parse failed${attempt < 2 ? " — retrying" : ""}`);
    }
  }
  return null;
}

/** Generate about-page content using the template's about-page spec. */
export async function generateAboutContent(ctx: {
  config: Config;
  spec: TemplateSpec;
  businessInfo: string;
  brandGuidelines: string;
  siteStrategy: string;
  siteHierarchy: string;
  artifactContext: string;
  brief?: PageBrief;
  sitePlaybook: string;
  conversionBrief: string;
  log: (msg: string) => void;
}): Promise<Partial<AboutContent> | null> {
  const { config, log, brief, ...promptCtx } = ctx;
  const briefContext = brief ? buildAboutBriefContext(brief) : "(no extracted content found for the about page)";
  const prompt = buildAboutPrompt({ ...promptCtx, briefContext });

  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await chatCompletion(
      { model: config.DEFAULT_LLM_MODEL, messages: [{ role: "user", content: prompt }], temperature: attempt === 1 ? 0.3 : 0 },
      config,
    );
    const jsonText = extractJsonObject(response.content ?? "");
    if (!jsonText) {
      log(`  [warn] about attempt ${attempt}: LLM returned no JSON${attempt < 2 ? " — retrying" : ""}`);
      continue;
    }
    try {
      const parsed = JSON.parse(jsonText) as GeneratedAboutPage;
      const result: Partial<AboutContent> = {};
      if (parsed.hero?.headline) {
        result.hero = {
          headline: parsed.hero.headline,
          subheading: parsed.hero.subheading,
          intro: parsed.hero.intro,
          ctaLabel: parsed.hero.ctaLabel,
          ctaUrl: parsed.hero.ctaUrl,
        };
      }
      if (parsed.story?.headline || parsed.story?.blocks?.length) {
        result.story = {
          headline: parsed.story.headline,
          subheadline: parsed.story.subheadline,
          imageUrl: parsed.story.imageUrl,
          imageAlt: parsed.story.imageAlt,
          blocks: sanitizeContentBlocks(
            parsed.story.blocks?.map((b) => ({ type: (b.type as any) || "text", html: b.html ?? "" })),
          ),
        };
      }
      if (parsed.community?.body) {
        result.communityHeadline = parsed.community.headline;
        result.communityBody = sanitizeHtml(parsed.community.body);
      }
      if (parsed.team?.members?.length) {
        result.team = parsed.team.members
          .filter((m) => m.name && m.title)
          .map((m) => ({
            name: m.name!,
            title: m.title!,
            photoUrl: m.photoUrl || NO_IMAGE,
            bio: m.bio,
          }));
      }
      if (parsed.testimonials?.items?.length) {
        result.testimonials = parsed.testimonials.items
          .filter((t) => t.quote && t.name)
          .map((t) => ({ quote: t.quote!, name: t.name!, program: t.program }));
      }
      if (parsed.ctaBand?.headline) {
        result.ctaHeadline = parsed.ctaBand.headline;
      }
      if (parsed.faq?.length) {
        result.faq = parsed.faq
          .filter((f) => f.question && f.answer)
          .map((f) => ({ question: f.question!, answer: f.answer! }));
      }
      return result;
    } catch {
      log(`  [warn] about attempt ${attempt}: JSON parse failed${attempt < 2 ? " — retrying" : ""}`);
    }
  }
  return null;
}

// ── Main generation ──────────────────────────────────────────────────────────

export async function generateSiteContent(input: GenerateContentInput): Promise<GymSiteContent> {
  const { db, config, siteUuid, workspaceUuid, apiBaseUrl, siteUrl, log = () => {} } = input;
  const theme = input.templateTheme ?? "beanburito";

  log(`  Loading docs and artifacts...`);

  // Load all available docs in parallel
  const [businessInfo, brandGuidelines, siteStrategy, siteHierarchy, workspaceMemory] = await Promise.all([
    loadDoc(db, siteUuid, "business-info"),
    loadDoc(db, siteUuid, "brand-guidelines"),
    loadDoc(db, siteUuid, "site-strategy"),
    loadDoc(db, siteUuid, "site-hierarchy"),
    loadDoc(db, siteUuid, "workspace-memory"),
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

  // Pick spec based on theme from the registry.
  const spec = getTemplateSpec(theme);
  if (!spec) {
    log(`  No spec for theme "${theme}" — returning base content`);
    return baseContent;
  }

  // Extract testimonials and FAQ from content artifact (real content, not generated)
  const homePage = contentArtifact?.pages?.find((p) => p.path === "/");
  const homeCf = homePage?.contentFound;
  const artifactHero = homeCf?.hero;
  const homeTestimonials = homeCf?.testimonials ?? [];
  const homeFaq = homeCf?.faq ?? [];
  const existingTestimonials: Testimonial[] = homeTestimonials
    .filter((t) => t.quote && t.name)
    .map((t) => ({ quote: t.quote, name: t.name, program: t.program ? t.program : undefined }));
  const existingFaq: FAQItem[] = homeFaq
    .filter((f) => f.question && f.answer)
    .map((f) => ({ question: f.question, answer: f.answer }));

  const artifactContext = buildContextFromArtifact(contentArtifact);

  // Trim business-info: remove the Testimonials section (long, LLM-busting)
  // Testimonials come from the content artifact separately
  const businessInfoTrimmed = (businessInfo || "")
    .replace(/^## Testimonials[\s\S]*$/m, "")
    .trim()
    .slice(0, 1500);

  // Build shared conversion context
  const sitePlaybook = buildSitePlaybook(siteStrategy, workspaceMemory, businessInfo);
  const homePageSpec = spec.pages.home;
  const homeConversionBrief = homePageSpec ? buildConversionBrief(homePageSpec) : "";

  // Generate about-page content when the site hierarchy includes an about page.
  let generatedAbout: Partial<AboutContent> | null = null;
  const aboutPageSpec = spec.pages.about;
  if (aboutPageSpec) {
    let hierarchy: SiteHierarchy | null = null;
    try {
      hierarchy = siteHierarchy ? JSON.parse(siteHierarchy) as SiteHierarchy : null;
    } catch {
      hierarchy = null;
    }
    const hasAboutPage = hierarchy?.pages?.some((p) => p.path === "/about" || p.slug === "about");
    if (hasAboutPage) {
      const aboutBrief = findAboutBrief(contentArtifact);
      const aboutConversionBrief = buildConversionBrief(aboutPageSpec);
      generatedAbout = await generateAboutContent({
        config,
        spec,
        businessInfo: businessInfoTrimmed,
        brandGuidelines,
        siteStrategy,
        siteHierarchy,
        artifactContext,
        brief: aboutBrief,
        sitePlaybook,
        conversionBrief: aboutConversionBrief,
        log,
      });
      if (generatedAbout) {
        log(`  About page content generated`);
      } else {
        log(`  [warn] About page generation failed — using base content`);
      }
    }
  }

  // Build the LLM prompt
  const specPrompt = buildSpecPrompt(spec);
  const prompt = `You are writing homepage content for a gym website. Use ONLY the gym's real information from the docs below. Be specific — use their actual name, city, programs, and story. Never use placeholder text.

## GYM DOCS

### Business Info
${businessInfoTrimmed || "(not available)"}

### Brand & Voice Guidelines
${(brandGuidelines || "").slice(0, 800)}

### Site Playbook
${sitePlaybook.slice(0, 1200)}

### Marketing Strategy
${(siteStrategy || "").slice(0, 600)}

### Site Structure (pages and programs they have)
${siteHierarchy ? siteHierarchy.slice(0, 1500) : "(not available)"}

${artifactContext ? artifactContext.slice(0, 1500) : ""}

---

## CONVERSION BRIEF FOR THIS PAGE

${homeConversionBrief || "Write homepage content that drives the gym's primary conversion action."}

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

  // Generate content for each program page using the template's program-page spec.
  const generatedProgramsBySlug = new Map<string, GeneratedProgramPage>();
  const programSpec = spec.pageSections?.program;
  if (programSpec && baseContent.pages.programs.length > 0) {
    log(`  Generating content for ${baseContent.pages.programs.length} program page(s)...`);
    for (const program of baseContent.pages.programs) {
      const brief = findProgramBrief(contentArtifact, program.slug);
      const programConversionBrief = spec.pages.program ? buildConversionBrief(spec.pages.program) : "";
      const programPrompt = buildProgramPrompt({
        spec,
        program,
        brief,
        businessInfo: businessInfoTrimmed,
        brandGuidelines,
        siteStrategy,
        siteHierarchy,
        artifactContext,
        sitePlaybook,
        conversionBrief: programConversionBrief,
      });

      let generatedProgram: GeneratedProgramPage | null = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const response = await chatCompletion(
          { model: config.DEFAULT_LLM_MODEL, messages: [{ role: "user", content: programPrompt }], temperature: attempt === 1 ? 0.3 : 0 },
          config,
        );
        const jsonText = extractJsonObject(response.content ?? "");
        if (!jsonText) {
          log(`  [warn] program ${program.slug} attempt ${attempt}: LLM returned no JSON${attempt < 2 ? " — retrying" : ""}`);
          continue;
        }
        try {
          generatedProgram = JSON.parse(jsonText) as GeneratedProgramPage;
          break;
        } catch {
          log(`  [warn] program ${program.slug} attempt ${attempt}: JSON parse failed${attempt < 2 ? " — retrying" : ""}`);
        }
      }

      if (generatedProgram) {
        generatedProgramsBySlug.set(program.slug, generatedProgram);
        log(`  Program page generated: ${program.slug}`);
      } else {
        log(`  [warn] program ${program.slug}: LLM generation failed — using base content`);
      }
    }
  }

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
    intro: baseContent.pages.home.hero.intro ?? generatedHero.intro ?? "",
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

  // If the source site provided its own map embed on the contact page, prefer it
  // over the synthetic GMB map so the replicated site matches the source.
  const contactMap = baseContent.pages.contact.iframes?.find((e) => e.variant === "map");
  if (contactMap) {
    baseContent.business.mapEmbedUrl = contactMap.src;
  }

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
    const generatedProgram = generatedProgramsBySlug.get(p.slug);
    const generatedDesc = programsBySlug.get(p.slug)?.shortDescription;
    const brief = findProgramBrief(contentArtifact, p.slug);

    const programContext = `${p.name} ${p.shortDescription ?? ""} ${generatedDesc ?? ""} ${generatedProgram?.whatIsIt?.body ?? ""} program workout`.trim();
    const matched = imageMatcher.match({
      query: programContext,
      exclude: usedProgramImages,
      preferredSectionType: "feature-grid",
    });
    const coverImageUrl = matched
      ?? (hasVisionTags ? placeholderImage(p.name, 800, 600) : fallbackPicker(usedProgramImages))
      ?? p.coverImageUrl;
    if (coverImageUrl) usedProgramImages.add(coverImageUrl);

    // Hero: prefer source-extracted headline, then LLM, then base.
    const extractedHeroHeadline = brief?.contentFound.hero.headline;
    const genHero = generatedProgram?.hero;
    const finalHero: HeroContent = {
      ...p.hero,
      headline: extractedHeroHeadline || genHero?.headline || p.hero.headline || `Try our ${p.name}`,
      subheading: brief?.contentFound.hero.subheading || genHero?.subheading || p.hero.subheading,
      intro: genHero?.intro || p.hero.intro,
      ctaLabel: genHero?.ctaLabel || p.hero.ctaLabel || baseContent.business.primaryCta.label,
      ctaUrl: genHero?.ctaUrl || p.hero.ctaUrl || baseContent.business.primaryCta.url,
      backgroundImageUrl: coverImageUrl || p.hero.backgroundImageUrl,
    };

    // What is it: generated wins, then extracted body, then base.
    const extractedBody = brief?.contentFound.body && brief.contentFound.body.length > 40
      ? brief.contentFound.body.slice(0, 600)
      : undefined;
    const whatIsIt = {
      headline: generatedProgram?.whatIsIt?.headline || extractedHeroHeadline || p.whatIsIt.headline || `What is ${p.name.toLowerCase()}?`,
      body: generatedProgram?.whatIsIt?.body || extractedBody || p.whatIsIt.body || "",
    };

    // Differentiators: generated, then extracted, then base (usually empty).
    const different = generatedProgram?.whatMakesUsDifferent?.filter((s) => s?.trim?.())?.length
      ? generatedProgram.whatMakesUsDifferent.filter((s) => s.trim().length > 0)
      : (brief?.contentFound.whatMakesUsDifferent ?? p.whatMakesUsDifferent);

    // What to expect: only generated/template has this; base is usually empty.
    const whatToExpect = {
      headline: generatedProgram?.whatToExpect?.headline || p.whatToExpect.headline || "What to expect",
      steps: generatedProgram?.whatToExpect?.steps?.filter((s) => s?.trim?.()) ?? p.whatToExpect.steps,
    };

    // Who it's for: generated, then extracted, then base.
    const whoIsItFor = generatedProgram?.whoIsItFor?.filter((s) => s?.trim?.())?.length
      ? generatedProgram.whoIsItFor.filter((s) => s.trim().length > 0)
      : (brief?.contentFound.whoIsItFor ?? p.whoIsItFor);

    // Getting started steps: generated, then base, then homepage how-it-works as a last resort.
    const gettingStarted: Step[] = generatedProgram?.gettingStarted?.length
      ? generatedProgram.gettingStarted.map((s, i) => ({ number: i + 1, headline: String(s.headline ?? ""), body: String(s.body ?? "") }))
      : (p.gettingStarted.length > 0 ? p.gettingStarted : baseContent.pages.home.howItWorks);

    // Testimonials: prefer program-specific extracted, then generated, then homepage pool.
    const programTestimonials: Testimonial[] = (brief?.contentFound.testimonials ?? [])
      .filter((t) => t.quote && t.name)
      .map((t) => ({ quote: t.quote, name: t.name, program: p.name }));
    const generatedTestimonials: Testimonial[] = (generatedProgram?.testimonials ?? [])
      .filter((t) => t.quote && t.name)
      .map((t) => ({ quote: t.quote, name: t.name, program: p.name }));
    const testimonials = programTestimonials.length > 0
      ? programTestimonials
      : (generatedTestimonials.length > 0 ? generatedTestimonials : baseContent.pages.home.testimonials);

    // FAQ: prefer program-specific extracted, then generated, then homepage pool.
    const programFaq: FAQItem[] = (brief?.contentFound.faq ?? [])
      .filter((f) => f.question && f.answer)
      .map((f) => ({ question: f.question, answer: f.answer }));
    const generatedFaq: FAQItem[] = (generatedProgram?.faq ?? [])
      .filter((f) => f.question && f.answer)
      .map((f) => ({ question: f.question, answer: f.answer }));
    const faq = programFaq.length > 0
      ? programFaq
      : (generatedFaq.length > 0 ? generatedFaq : baseContent.pages.home.faq);

    return {
      ...p,
      shortDescription: generatedDesc ? String(generatedDesc).slice(0, 160) : p.shortDescription,
      coverImageUrl,
      hero: finalHero,
      whatIsIt,
      whatMakesUsDifferent: different,
      whatToExpect: whatToExpect,
      whoIsItFor,
      gettingStarted,
      testimonials,
      faq,
    };
  });

  // Merge generated about-page content into the base page and assign real
  // images for the hero, story, and team members when available.
  if (generatedAbout) {
    baseContent.pages.about = mergeGeneratedAboutContent(
      baseContent.pages.about,
      generatedAbout,
      baseContent.pages.home.faq,
    );
  }

  const aboutPage = baseContent.pages.about;
  if (!aboutPage.hero.backgroundImageUrl || aboutPage.hero.backgroundImageUrl === NO_IMAGE) {
    aboutPage.hero.backgroundImageUrl = imageMatcher.match({
      query: `${aboutPage.hero.headline} ${baseContent.business.name} about hero`,
      preferredSectionType: "hero",
    }) || NO_IMAGE;
  }
  if (!aboutPage.story?.imageUrl || aboutPage.story.imageUrl === NO_IMAGE) {
    aboutPage.story = {
      ...aboutPage.story,
      imageUrl: imageMatcher.match({
        query: `${baseContent.business.name} founder story team`,
        preferredSectionType: "content-block",
      }) || NO_IMAGE,
    };
  }
  if (aboutPage.team?.length) {
    const usedTeamPhotos = new Set<string>();
    aboutPage.team = aboutPage.team.map((member) => {
      if (member.photoUrl && member.photoUrl !== NO_IMAGE) return member;
      const matched = imageMatcher.match({
        query: `${member.name} ${member.title} coach`,
        exclude: usedTeamPhotos,
        preferredSectionType: "content-block",
      });
      if (matched) usedTeamPhotos.add(matched);
      return { ...member, photoUrl: matched || NO_IMAGE };
    });
  }

  // Generate 10 long-tail local SEO FAQs for every templated static page.
  // Program-page FAQ is handled inside the per-program loop above.
  if (spec?.pageSections?.faq) {
    const staticTargets: Array<{ key: keyof GymSiteContent["pages"]; path: string; title: string }> = [
      { key: "about", path: "/about", title: baseContent.pages.about.hero.headline || "About" },
      { key: "pricing", path: "/pricing", title: baseContent.pages.pricing.hero.headline || "Pricing" },
      { key: "contact", path: "/contact", title: baseContent.pages.contact.hero.headline || "Contact" },
      { key: "schedule", path: "/schedule", title: baseContent.pages.schedule.hero.headline || "Schedule" },
      { key: "blog", path: "/blog", title: baseContent.pages.blog.heroHeadline || "Blog" },
    ];
    if (baseContent.pages.localGuide) {
      staticTargets.push({ key: "localGuide", path: "/local-guide", title: baseContent.pages.localGuide.hero.headline || "Local guide" });
    }

    for (const target of staticTargets) {
      const page = baseContent.pages[target.key] as { faq?: FAQItem[]; hero?: HeroContent } | undefined;
      if (!page) continue;
      const existingFaq = contentArtifact?.pages
        ?.find((p) => normalizePath(p.path) === target.path)
        ?.contentFound.faq ?? [];
      const faqPageSpec = spec.pages[target.key] ?? (target.key === "blog" ? spec.pages.blogIndex : undefined);
      const faqConversionBrief = faqPageSpec ? buildConversionBrief(faqPageSpec) : "";
      const generatedFaq = await generatePageFaq({
        config,
        spec,
        pageKey: target.key,
        pageTitle: target.title,
        pagePath: target.path,
        existingFaq,
        businessInfo: businessInfoTrimmed,
        brandGuidelines,
        siteStrategy,
        siteHierarchy,
        artifactContext,
        sitePlaybook,
        conversionBrief: faqConversionBrief,
        log,
      });
      const faq = generatedFaq?.length ? generatedFaq : existingFaq;
      if (faq.length) {
        (page as { faq?: FAQItem[] }).faq = faq.slice(0, 10);
        log(`  FAQ generated: ${target.key} (${faq.length} items)`);
      }
    }
  }

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

  // About page community fallback: use homepage community content when the about
  // page has none of its own.
  const about = mergedContent.pages.about;
  if (!about.communityBody && !about.communityProps?.length) {
    about.communityHeadline = about.communityHeadline || generatedHome.communityHeadline;
    about.communityProps = about.communityProps?.length ? about.communityProps : generatedHome.communityProps;
  }
  if (!about.communityHeadline) {
    about.communityHeadline = `About ${mergedContent.business.name}`;
  }

  // LLM-generated or source-captured CTAs may point to pages that won't be rendered.
  // Sanitize after all merges so every internal CTA is guaranteed valid.
  const { sanitizeContentCtas } = await import("./content-mapper.js");
  sanitizeContentCtas(mergedContent.pages, mergedContent.business, []);

  return mergedContent;
}
