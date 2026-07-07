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

function classifyPageType(
  path: string,
): "home" | "program" | "about" | "contact" | "pricing" | "schedule" | "other" {
  if (path === "/" || path === "") return "home";
  const s = path.toLowerCase();
  if (/\/programs\/|\/classes\/|\/crossfit|\/bootcamp|\/training/.test(s)) return "program";
  if (/\/about/.test(s)) return "about";
  if (/\/contact/.test(s)) return "contact";
  if (/\/pricing|\/membership|\/rates/.test(s)) return "pricing";
  if (/\/schedule/.test(s)) return "schedule";
  return "other";
}

function extractJsonObject(raw: string): string | undefined {
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

export interface PageBrief {
  path: string;
  pageType: string;
  purpose: string;
  visitorRole: "awareness" | "consideration" | "conversion" | "retention" | "utility";
  sectionsNeeded: string[];
  contentFound: {
    hero: { headline: string | null; subheading: string | null; ctaLabel: string | null };
    body: string;
    cta: string | null;
    // Home
    valueProps?: Array<{ headline: string; body: string }>;
    testimonials?: Array<{ quote: string; name: string; program?: string }>;
    faq?: Array<{ question: string; answer: string }>;
    communityHeadline?: string | null;
    trustHeadline?: string | null;
    // Program
    shortDescription?: string | null;
    whoIsItFor?: string[];
    whatMakesUsDifferent?: string[];
    // About
    gymStory?: string | null;
    team?: Array<{ name: string; title: string; bio?: string | null }>;
    // Contact
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    hours?: string | null;
    // Pricing
    plans?: Array<{ name: string; price: string; period?: string | null; description?: string | null; features: string[] }>;
  };
  contentMissing: string[];
  generationHint: string;
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

    ctx.log(`  Processing ${structuralPages.length} pages (${allPages.length - structuralPages.length} UGC skipped)`);

    const briefs: PageBrief[] = [];
    let successCount = 0;
    const warnings: string[] = [];

    for (const page of structuralPages) {
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

        const brief = JSON.parse(jsonText) as PageBrief;
        brief.path = page.path;
        brief.pageType = pageType;
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
      pages: briefs,
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
      metrics: { pages: successCount, skipped: structuralPages.length - successCount },
      warnings,
    };
  },
};
