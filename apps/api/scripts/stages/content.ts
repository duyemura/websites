// apps/api/scripts/stages/content.ts
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { chatCompletion } from "../../src/ai/llm-client";
import { saveArtifact, loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { pathToOutlineKey } from "../../src/services/mirror/snapshot";
import type { StageRunner, StageContext, StageResult } from "./types";
import type { PipelineStage } from "../../src/types/pipeline-artifacts";

const MAX_CONTENT_PAGES = 20;

interface MirrorDeployArtifact {
  deployPrefix: string;
  previewUrl: string;
  pageCount: number;
  warnings: string[];
  host?: string;
  preview?: boolean;
  snapshotWarnings?: string[];
}

// Sections each page type should have in the Astro template
const PAGE_SECTIONS: Record<string, string[]> = {
  home: ["hero", "value-props", "programs-preview", "testimonials", "cta"],
  program: ["hero", "description", "who-is-it-for", "schedule-or-pricing", "testimonials", "cta"],
  about: ["hero", "gym-story", "team", "values", "cta"],
  contact: ["hero", "contact-form", "location-hours", "map"],
  pricing: ["hero", "plans", "faq", "cta"],
  schedule: ["hero", "class-schedule", "booking-cta"],
  other: ["hero", "content", "cta"],
};

// Page-type-specific structured fields to extract into contentFound
const PAGE_TYPE_FIELDS: Record<string, string> = {
  home: `"valueProps": [{"headline": string, "body": string}],
  "testimonials": [{"quote": string, "name": string, "program": string | null}],
  "faq": [{"question": string, "answer": string}],
  "communityHeadline": string | null,
  "trustHeadline": string | null`,

  program: `"shortDescription": string | null,
  "whoIsItFor": [string],
  "whatMakesUsDifferent": [string],
  "testimonials": [{"quote": string, "name": string}],
  "faq": [{"question": string, "answer": string}]`,

  about: `"gymStory": string | null,
  "team": [{"name": string, "title": string, "bio": string | null}]`,

  contact: `"phone": string | null,
  "email": string | null,
  "address": string | null,
  "city": string | null,
  "state": string | null,
  "zip": string | null,
  "hours": string | null`,

  pricing: `"plans": [{"name": string, "price": string, "period": string | null, "description": string | null, "features": [string]}]`,
};

export function classifyPageType(
  path: string,
): "home" | "program" | "about" | "contact" | "pricing" | "schedule" | "other" {
  if (path === "/" || path === "") return "home";
  const s = path.toLowerCase();
  // Match program-related keywords with or without leading slash (handles /crossfit, /crossfit-classes, /personal-training)
  if (/\/programs\/|\/classes\/|crossfit|bootcamp|personal-training|strength-training/.test(s)) return "program";
  if (/\/about|about-us/.test(s)) return "about";
  if (/\/contact|contact-us/.test(s)) return "contact";
  if (/\/pricing|\/membership|\/rates/.test(s)) return "pricing";
  if (/\/schedule|class-schedule/.test(s)) return "schedule";
  return "other";
}

export function extractJsonObject(raw: string): string | undefined {
  const start = raw.indexOf("{");
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) { escape = false; }
      else if (ch === "\\") { escape = true; }
      else if (ch === '"') { inString = false; }
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return undefined;
}

function buildPrompt(
  pageType: string,
  path: string,
  outline: string,
  businessContext: string,
  sectionsNeeded: string[],
): string {
  const typeFields = PAGE_TYPE_FIELDS[pageType] ?? "";
  const contentFoundSchema = `{
    "hero": {"headline": string | null, "subheading": string | null, "ctaLabel": string | null},
    "body": "all key content as plain text",
    "cta": string | null${typeFields ? `,\n    ${typeFields}` : ""}
  }`;

  return `You are planning an Astro website page for a gym. Produce a page brief the Astro template builder will use to build this page.

Business context:
${businessContext}

Page: ${path} (type: ${pageType})
Sections this page type needs: ${sectionsNeeded.join(", ")}

Content outline from the original page:
${outline || "(no content found — flag all sections as missing)"}

Return ONLY valid JSON:
{
  "purpose": "one sentence — why this page exists and what the visitor is trying to do",
  "visitorRole": "one of: awareness | consideration | conversion | retention | utility",
  "sectionsNeeded": ["ordered list of sections to build"],
  "contentFound": ${contentFoundSchema},
  "contentMissing": ["sections or fields not found that need to be generated"],
  "generationHint": "1-2 sentences to help the template builder fill gaps using business info"
}`;
}

// Guaranteed shape — every field always present after normalization.
// Null means "not found", empty array means "none found". Never undefined.
export interface PageBrief {
  path: string;
  pageType: string;
  purpose: string;
  visitorRole: "awareness" | "consideration" | "conversion" | "retention" | "utility";
  sectionsNeeded: string[];
  contentFound: {
    // Always present on every page
    hero: { headline: string | null; subheading: string | null; ctaLabel: string | null };
    body: string;
    cta: string | null;
    // Home + program
    valueProps: Array<{ headline: string; body: string }>;
    testimonials: Array<{ quote: string; name: string; program: string | null }>;
    faq: Array<{ question: string; answer: string }>;
    communityHeadline: string | null;
    trustHeadline: string | null;
    // Program
    shortDescription: string | null;
    whoIsItFor: string[];
    whatMakesUsDifferent: string[];
    // About
    gymStory: string | null;
    team: Array<{ name: string; title: string; bio: string | null }>;
    // Contact
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    hours: string | null;
    // Pricing
    plans: Array<{ name: string; price: string; period: string | null; description: string | null; features: string[] }>;
  };
  contentMissing: string[];
  generationHint: string;
}

/** Enforce the guaranteed shape after LLM output — fill every missing field with its typed zero value. */
export function normalizeBrief(raw: unknown, path: string, pageType: string): PageBrief {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cf = ((r.contentFound ?? {}) as Record<string, unknown>);
  const hero = ((cf.hero ?? {}) as Record<string, unknown>);
  return {
    path,
    pageType,
    purpose: String(r.purpose ?? ""),
    visitorRole: (["awareness","consideration","conversion","retention","utility"].includes(r.visitorRole as string)
      ? r.visitorRole : "conversion") as PageBrief["visitorRole"],
    sectionsNeeded: Array.isArray(r.sectionsNeeded) ? r.sectionsNeeded.map(String) : (PAGE_SECTIONS[pageType] ?? PAGE_SECTIONS.other),
    contentFound: {
      hero: {
        headline: String(hero.headline ?? "") || null,
        subheading: String(hero.subheading ?? "") || null,
        ctaLabel: String(hero.ctaLabel ?? "") || null,
      },
      body: String(cf.body ?? ""),
      cta: String(cf.cta ?? "") || null,
      valueProps: Array.isArray(cf.valueProps) ? cf.valueProps.map((v: any) => ({ headline: String(v.headline ?? ""), body: String(v.body ?? "") })) : [],
      testimonials: Array.isArray(cf.testimonials) ? cf.testimonials.map((t: any) => ({ quote: String(t.quote ?? ""), name: String(t.name ?? ""), program: String(t.program ?? "") || null })) : [],
      faq: Array.isArray(cf.faq) ? cf.faq.map((f: any) => ({ question: String(f.question ?? ""), answer: String(f.answer ?? "") })) : [],
      communityHeadline: String(cf.communityHeadline ?? "") || null,
      trustHeadline: String(cf.trustHeadline ?? "") || null,
      shortDescription: String(cf.shortDescription ?? "") || null,
      whoIsItFor: Array.isArray(cf.whoIsItFor) ? cf.whoIsItFor.map(String) : [],
      whatMakesUsDifferent: Array.isArray(cf.whatMakesUsDifferent) ? cf.whatMakesUsDifferent.map(String) : [],
      gymStory: String(cf.gymStory ?? "") || null,
      team: Array.isArray(cf.team) ? cf.team.map((m: any) => ({ name: String(m.name ?? ""), title: String(m.title ?? ""), bio: String(m.bio ?? "") || null })) : [],
      phone: String(cf.phone ?? "") || null,
      email: String(cf.email ?? "") || null,
      address: String(cf.address ?? "") || null,
      city: String(cf.city ?? "") || null,
      state: String(cf.state ?? "") || null,
      zip: String(cf.zip ?? "") || null,
      hours: String(cf.hours ?? "") || null,
      plans: Array.isArray(cf.plans) ? cf.plans.map((p: any) => ({ name: String(p.name ?? ""), price: String(p.price ?? ""), period: String(p.period ?? "") || null, description: String(p.description ?? "") || null, features: Array.isArray(p.features) ? p.features.map(String) : [] })) : [],
    },
    contentMissing: Array.isArray(r.contentMissing) ? r.contentMissing.map(String) : [],
    generationHint: String(r.generationHint ?? ""),
  };
}

/** Merge new briefs into existing. Incoming briefs replace existing at the same path. */
export function mergeBriefs(existing: PageBrief[], incoming: PageBrief[]): PageBrief[] {
  const incomingPaths = new Set(incoming.map((b) => b.path));
  return [...existing.filter((b) => !incomingPaths.has(b.path)), ...incoming];
}

export interface ContentArtifact {
  siteUuid: string;
  createdAt: string;
  pages: PageBrief[];
}

export const contentStage: StageRunner = {
  label: "content",
  requires: ["mirror-deploy", "mirror-crawl"],
  produces: "content" as PipelineStage,

  async run(ctx: StageContext): Promise<StageResult> {
    const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;

    const deployArtifact = await loadArtifact<MirrorDeployArtifact>(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "mirror-deploy",
    );
    if (!deployArtifact) {
      throw new Error("No mirror-deploy artifact found — run the clone stage first");
    }
    const deployPrefix = deployArtifact.payload.deployPrefix;

    const businessDoc = await ctx.db
      .selectFrom("docs")
      .select("content")
      .where("siteUuid", "=", ctx.siteUuid)
      .where("key", "=", "business-info")
      .where("status", "=", "active")
      .executeTakeFirst();
    const businessContext = businessDoc?.content ?? "(no business info available)";

    const crawlArtifact = (await loadArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "mirror-crawl" as PipelineStage,
    )) as unknown as { payload?: { pages?: Array<{ path: string }> } };

    const allPages: Array<{ path: string }> = crawlArtifact?.payload?.pages ?? [];
    const structuralPages = allPages
      .filter((p) => !/\/blog\/|\/recipe|\/news\/|\/post\//.test(p.path.toLowerCase()))
      .slice(0, MAX_CONTENT_PAGES);

    // pageFilter: scoped run for milo page (only process specified paths)
    const pagesToProcess = ctx.pageFilter
      ? structuralPages.filter((p) => ctx.pageFilter!.includes(p.path))
      : structuralPages;

    // Load existing briefs when running in filtered mode — we merge, not replace
    let existingBriefs: PageBrief[] = [];
    if (ctx.pageFilter) {
      const existing = (await loadArtifact(
        ctx.db,
        { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
        "content" as PipelineStage,
      )) as { payload?: ContentArtifact } | null;
      existingBriefs = existing?.payload?.pages ?? [];
    }

    const skipped = ctx.pageFilter
      ? `filtered to: ${ctx.pageFilter.join(", ")}`
      : `${allPages.length - structuralPages.length} UGC skipped`;
    ctx.log(`  Processing ${pagesToProcess.length} pages (${skipped})`);

    const briefs: PageBrief[] = [];
    let successCount = 0;
    const warnings: string[] = [];

    for (const page of pagesToProcess) {
      const pageType = classifyPageType(page.path);
      const sectionsNeeded = PAGE_SECTIONS[pageType] ?? PAGE_SECTIONS.other;
      const outlineKey = `${deployPrefix}/${pathToOutlineKey(page.path)}`;

      let outline = "";
      try {
        const outlineObj = await ctx.s3Client.send(
          new GetObjectCommand({ Bucket: bucket, Key: outlineKey }),
        );
        outline = (await outlineObj.Body?.transformToString()) ?? "";
      } catch {
        // No outline — LLM will flag all sections as missing
      }

      try {
        const prompt = buildPrompt(pageType, page.path, outline, businessContext, sectionsNeeded);
        const response = await chatCompletion(
          { model: ctx.config.DEFAULT_LLM_MODEL, messages: [{ role: "user", content: prompt }], temperature: 0 },
          ctx.config,
        );

        const jsonText = extractJsonObject(response.content ?? "");
        if (!jsonText) {
          warnings.push(`${page.path}: LLM returned no JSON`);
          continue;
        }

        const brief = normalizeBrief(JSON.parse(jsonText), page.path, pageType);
        briefs.push(brief);
        successCount++;

        const missing = brief.contentMissing?.length ?? 0;
        ctx.log(`  [${pageType}] ${page.path} — ${missing} missing sections`);
      } catch (err) {
        warnings.push(`${page.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const artifact: ContentArtifact = {
      siteUuid: ctx.siteUuid,
      createdAt: new Date().toISOString(),
      pages: ctx.pageFilter ? mergeBriefs(existingBriefs, briefs) : briefs,
    };

    await saveArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "content" as PipelineStage,
      artifact,
    );

    return {
      stage: "content",
      status: warnings.length > successCount ? "warn" : "pass",
      durationMs: 0,
      metrics: { pages: successCount, skipped: pagesToProcess.length - successCount },
      warnings,
    };
  },
};
