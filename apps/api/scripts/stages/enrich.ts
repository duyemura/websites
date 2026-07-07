// apps/api/scripts/stages/enrich.ts
// First stage: resolve authoritative business facts from Google Business Profile
// before we mirror the site. Produces an "enrich" artifact for docgen to consume.
import * as cheerio from "cheerio";
import type { GmbListing } from "@ploy-gyms/gmb-client";
import {
  enrichWithGmb,
  type GmbEnrichmentResult,
} from "../../src/utils/gmb-enrichment";
import type { ScrapedWebsiteData } from "../../src/utils/scrape-docs";
import { saveArtifact } from "../../src/utils/pipeline/artifact-store";
import type { StageRunner, StageContext, StageResult } from "./types";

export interface EnrichArtifact {
  enrichedAt: string;
  sourceUrl: string;
  applied: boolean;
  /** Authoritative GMB listing, when a strong match was found. */
  listing?: GmbListing;
  /** Scraper-shaped data after GMB enrichment (useful for doc generators). */
  data: ScrapedWebsiteData;
}

async function fetchHomePageSeed(url: string): Promise<{
  title: string;
  businessName?: string;
  description?: string;
}> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MiloBot/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { title: url };
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $("title").text().trim() || url;
    const description =
      $('meta[name="description"]').attr("content")?.trim() ||
      $('meta[property="og:description"]').attr("content")?.trim();

    // Prefer JSON-LD business name, then og:site_name, then first H1.
    let businessName: string | undefined;
    for (const script of $('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse($(script).text() || "{}") as unknown;
        const candidates: unknown[] = [];
        if (Array.isArray(parsed)) candidates.push(...parsed);
        else candidates.push(parsed);
        for (const c of candidates) {
          if (c && typeof c === "object" && "name" in c && typeof c.name === "string" && c.name.length > 1) {
            businessName = c.name;
            break;
          }
        }
        if (businessName) break;
      } catch {
        // ignore malformed JSON-LD
      }
    }
    if (!businessName) {
      businessName =
        $('meta[property="og:site_name"]').attr("content")?.trim() ||
        $("h1").first().text().trim();
    }

    return { title, businessName, description };
  } catch {
    return { title: url };
  }
}

function makeEmptyScraped(url: string, title: string): ScrapedWebsiteData {
  return {
    url,
    title,
    headings: [],
    paragraphs: [],
    buttons: [],
    navLinks: [],
    colors: [],
    fonts: [],
    fontSizes: [],
    images: [],
    layoutRules: [],
    faqs: [],
    testimonials: [],
    locations: [],
    team: [],
    offerings: [],
    contact: {},
  };
}

export const enrichStage: StageRunner = {
  label: "enrich",
  requires: [],
  produces: "enrich",

  async run(ctx: StageContext): Promise<StageResult> {
    const site = await ctx.db
      .selectFrom("sites")
      .select("sourceUrl")
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    if (!site.sourceUrl) {
      throw new Error("Site has no sourceUrl configured");
    }

    ctx.log(`  URL: ${site.sourceUrl}`);

    const seed = await fetchHomePageSeed(site.sourceUrl);
    ctx.log(`  Homepage title: ${seed.title}`);
    if (seed.businessName) ctx.log(`  Business name seed: ${seed.businessName}`);

    let data = makeEmptyScraped(site.sourceUrl, seed.title);
    data.businessName = seed.businessName;
    data.description = seed.description;

    const apiKey = ctx.config.GOOGLE_PLACES_API_KEY;
    let result: GmbEnrichmentResult = { applied: false };

    if (!apiKey) {
      ctx.log("  [warn] GOOGLE_PLACES_API_KEY not configured — skipping GMB enrichment");
    } else {
      ctx.log("  Resolving Google Business Profile...");
      try {
        const enriched = await enrichWithGmb(data, apiKey);
        data = enriched.data;
        result = enriched.result;
        if (result.applied && result.listing) {
          ctx.log(`  GMB match: ${result.listing.name} (${result.listing.primaryType ?? "unknown category"})`);
        } else {
          ctx.log("  [warn] No strong GMB match found for this URL");
        }
      } catch (err) {
        ctx.log(`  [warn] GMB enrichment failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const artifact: EnrichArtifact = {
      enrichedAt: new Date().toISOString(),
      sourceUrl: site.sourceUrl,
      applied: result.applied,
      listing: result.listing,
      data,
    };

    await saveArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "enrich", artifact);

    return {
      stage: "enrich",
      status: result.applied ? "pass" : "warn",
      durationMs: 0,
      metrics: {
        applied: result.applied ? 1 : 0,
        gmbMatch: result.listing?.name ?? "none",
      },
      warnings: result.applied
        ? []
        : [apiKey ? "no strong GMB match found" : "GOOGLE_PLACES_API_KEY not configured"],
    };
  },
};
