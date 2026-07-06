// apps/api/scripts/stages/content.ts
import * as cheerio from "cheerio";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { chatCompletion } from "../../src/ai/llm-client";
import { saveArtifact, loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { pathToFileKey } from "../../src/services/mirror/snapshot";
import type { StageRunner, StageContext, StageResult } from "./types";

const MAX_CONTENT_PAGES = 20;

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

function extractBodyText(html: string): string {
  const $ = cheerio.load(html);
  $(
    "script, style, noscript, iframe, nav, header, footer, [aria-hidden='true']",
  ).remove();
  $(
    "[class*='nav'], [class*='header'], [class*='footer'], [class*='cookie'], [class*='popup']",
  ).remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return text.slice(0, 8000);
}

function buildPrompt(pageType: string, text: string, path: string): string {
  const base = `Extract structured content from this gym website page. Return ONLY valid JSON. Use null for fields not found.\n\nPage path: ${path}\nPage text:\n${text}\n\n`;

  const schemas: Record<string, string> = {
    home: `Return JSON:\n{"heroHeadline":string|null,"heroSubheading":string|null,"heroCtaLabel":string|null,"valueProps":[{"headline":string,"body":string}],"testimonials":[{"quote":string,"name":string,"program":string|null}],"faq":[{"question":string,"answer":string}],"communityHeadline":string|null,"trustHeadline":string|null}`,
    program: `Return JSON:\n{"name":string|null,"shortDescription":string|null,"heroHeadline":string|null,"heroSubheading":string|null,"whoIsItFor":[string],"whatMakesUsDifferent":[string],"testimonials":[{"quote":string,"name":string}],"faq":[{"question":string,"answer":string}]}`,
    about: `Return JSON:\n{"heroHeadline":string|null,"gymStory":string|null,"team":[{"name":string,"title":string,"bio":string|null}]}`,
    contact: `Return JSON:\n{"heroHeadline":string|null,"phone":string|null,"email":string|null,"address":string|null,"city":string|null,"state":string|null,"zip":string|null,"hours":string|null}`,
    pricing: `Return JSON:\n{"heroHeadline":string|null,"plans":[{"name":string,"price":string,"period":string|null,"description":string|null,"features":[string]}]}`,
    schedule: `Return JSON:\n{"heroHeadline":string|null,"note":string|null}`,
    other: `Return JSON:\n{"heroHeadline":string|null,"summary":string|null}`,
  };

  return base + (schemas[pageType] ?? schemas.other);
}

export interface PageContentExtraction {
  path: string;
  pageType: string;
  data: Record<string, unknown>;
}

export interface ContentExtractionArtifact {
  siteUuid: string;
  extractedAt: string;
  pages: PageContentExtraction[];
}

export const contentStage: StageRunner = {
  label: "content",
  requires: ["mirror-deploy"],
  produces: "content-extraction" as any,

  async run(ctx: StageContext): Promise<StageResult> {
    const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;

    const crawlArtifact = (await loadArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "mirror-crawl" as any,
    )) as any;

    const allPages: Array<{ path: string }> = crawlArtifact?.payload?.pages ?? [];

    const structuralPages = allPages
      .filter((p) => {
        const s = p.path.toLowerCase();
        return !/\/blog\/|\/recipe|\/news\/|\/post\//.test(s);
      })
      .slice(0, MAX_CONTENT_PAGES);

    ctx.log(
      `  Processing ${structuralPages.length} pages (skipped ${allPages.length - structuralPages.length} UGC)`,
    );

    const results: PageContentExtraction[] = [];
    let successCount = 0;
    const warnings: string[] = [];

    for (const page of structuralPages) {
      const pageType = classifyPageType(page.path);
      const s3Key = `sites/${ctx.siteUuid}/current/${pathToFileKey(page.path)}`;

      try {
        const obj = await ctx.s3Client.send(
          new GetObjectCommand({ Bucket: bucket, Key: s3Key }),
        );
        const html = (await obj.Body?.transformToString()) ?? "";
        if (!html) {
          warnings.push(`${page.path}: empty HTML`);
          continue;
        }

        const text = extractBodyText(html);
        if (!text || text.length < 50) {
          warnings.push(`${page.path}: no text content`);
          continue;
        }

        const prompt = buildPrompt(pageType, text, page.path);
        const response = await chatCompletion(
          {
            model: ctx.config.DEFAULT_LLM_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
          },
          ctx.config,
        );

        const raw = response.content ?? "";
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          warnings.push(`${page.path}: LLM returned no JSON`);
          continue;
        }

        const data = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        results.push({ path: page.path, pageType, data });
        successCount++;
        ctx.log(`  [${pageType}] ${page.path} ✓`);
      } catch (err) {
        warnings.push(`${page.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const artifact: ContentExtractionArtifact = {
      siteUuid: ctx.siteUuid,
      extractedAt: new Date().toISOString(),
      pages: results,
    };

    await saveArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "content-extraction" as any,
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
