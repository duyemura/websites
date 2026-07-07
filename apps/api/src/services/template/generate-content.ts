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
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import type { GymSiteContent, HomeContent, HeroContent, ValueProp, Step, Feature, FAQItem, Testimonial } from "@ploy-gyms/shared-types";
import { beanburitoSpec, buildSpecPrompt } from "./specs/beanburito.js";
import { chatCompletion } from "../../ai/llm-client.js";

export interface GenerateContentInput {
  db: Kysely<DB>;
  config: Config;
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

  // Build the LLM prompt
  const specPrompt = buildSpecPrompt(spec);
  const prompt = `You are writing homepage content for a gym website. Use ONLY the gym's real information from the docs below. Be specific — use their actual name, city, programs, and story. Never use placeholder text.

## GYM DOCS

### Business Info
${businessInfo || "(not available)"}

### Brand & Voice Guidelines
${brandGuidelines || "(not available)"}

### Marketing Strategy
${siteStrategy || "(not available)"}

### Site Structure (pages and programs they have)
${siteHierarchy ? siteHierarchy.slice(0, 2000) : "(not available)"}

${artifactContext || ""}

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
  "trustHeadline": "string (5-10 words, social proof)"
}`;

  log(`  Calling LLM to generate homepage content (${spec.name} spec)...`);
  const response = await chatCompletion(
    { model: config.DEFAULT_LLM_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0.3 },
    config,
  );

  const jsonText = extractJsonObject(response.content ?? "");
  if (!jsonText) {
    log(`  [warn] LLM returned no JSON — using base content`);
    return baseContent;
  }

  let generated: GeneratedHomeSlots;
  try {
    generated = JSON.parse(jsonText) as GeneratedHomeSlots;
  } catch {
    log(`  [warn] LLM JSON parse failed — using base content`);
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
    backgroundImageUrl: baseHero.backgroundImageUrl,
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

  return {
    ...baseContent,
    pages: {
      ...baseContent.pages,
      home: generatedHome,
    },
  };
}
