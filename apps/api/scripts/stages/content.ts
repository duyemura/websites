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
  return `You are planning an Astro website page for a gym. Your job is to produce a page brief — not just extract content, but understand the purpose of the page and what the Astro template will need to build it.

Business context:
${businessContext}

Page: ${path} (type: ${pageType})
Sections this page type should have: ${sectionsNeeded.join(", ")}

Content outline scraped from the original page:
${outline || "(no content found on this page)"}

Return ONLY valid JSON in this exact shape:
{
  "purpose": "one sentence — why this page exists and what the visitor is trying to do",
  "visitorRole": "one of: awareness | consideration | conversion | retention | utility",
  "sectionsNeeded": ["ordered list of sections to build in the Astro template"],
  "contentFound": {
    "hero": { "headline": string | null, "subheading": string | null, "ctaLabel": string | null },
    "body": "any key content found (quotes, descriptions, team names, pricing, hours, etc.) as a flat string",
    "cta": string | null
  },
  "contentMissing": ["list of sections or fields that were not found and need to be generated or filled in"],
  "generationHint": "1-2 sentences of context to help the template builder generate missing content using business info"
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

    // Load business context — used in every page brief so the LLM can fill gaps
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
        // No outline — proceed with empty; LLM will flag all sections as missing
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
