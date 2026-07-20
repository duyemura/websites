// apps/api/scripts/stages/docgen.ts
// Build the site docs from the clone's homepage HTML plus the GMB enrichment
// artifact. No extract/segment required, and no LLM business-info extraction.
import type { GmbListing } from "@milo/gmb-client";
import type { ScrapedWebsiteData } from "../../src/utils/scrape-docs";
import {
  generateSiteDocs,
  saveSiteDocs,
} from "../../src/utils/site-docs";
import { saveArtifact, loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { buildScrapedWebsiteDataFromCrawl } from "../../src/utils/mirror/crawl-to-scraped";
import type { MirrorCrawlArtifact } from "../../src/types/mirror";
import type { EnrichArtifact } from "./enrich";
import type { StageRunner, StageContext, StageResult } from "./types";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import * as cheerio from "cheerio";

function formatGmbAddress(listing: GmbListing): string | undefined {
  if (!listing.address) return undefined;
  const { streetNumber, streetName, city, state, postalCode } = listing.address;
  const street = [streetNumber, streetName].filter(Boolean).join(" ");
  const parts = [street, city, state, postalCode].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatGmbHours(listing: GmbListing): string | undefined {
  if (!listing.regularOpeningHours?.length) return undefined;
  return listing.regularOpeningHours
    .map((h) => {
      const label = h.day.charAt(0) + h.day.slice(1).toLowerCase();
      if (h.isClosed || !h.open) return `${label}: Closed`;
      return `${label}: ${h.open}–${h.close ?? "—"}`;
    })
    .join("\n");
}

/**
 * Merge GMB-enriched facts into the cheerio-parsed homepage data. GMB wins for
 * business identity, contact, location, and hours because it is the
 * authoritative source.
 */
function mergeGmbIntoScraped(
  scraped: ScrapedWebsiteData,
  gmb?: GmbListing,
): ScrapedWebsiteData {
  if (!gmb) return scraped;

  const merged: ScrapedWebsiteData = { ...scraped };

  if (gmb.name && gmb.name.length > 1) {
    merged.businessName = gmb.name;
  }
  if (gmb.editorialSummary) {
    merged.tagline = gmb.editorialSummary;
  }
  if (gmb.primaryType) {
    merged.industry = gmb.primaryType;
  }

  if (gmb.phoneNumber) {
    merged.contact = { ...merged.contact, phone: gmb.phoneNumber };
  }

  const gmbAddress = formatGmbAddress(gmb);
  const gmbHours = formatGmbHours(gmb);
  if (gmbAddress || gmbHours) {
    const existing = merged.locations[0] ?? {};
    merged.locations = [
      {
        ...existing,
        name: existing.name ?? gmb.name,
        address: gmbAddress ?? existing.address,
        hours: gmbHours ?? existing.hours,
      },
      ...merged.locations.slice(1),
    ];
  }

  if (merged.testimonials.length === 0 && gmb.reviews?.length > 0) {
    merged.testimonials = gmb.reviews.map((r) => ({
      quote: r.text ?? "",
      author: r.author,
      role: undefined,
    }));
  }

  return merged;
}

export const docgenStage: StageRunner = {
  label: "docgen",
  // enrich is optional — template builds don't run it (template sources are not real businesses).
  // When the enrich artifact is present (real gym sign-up), GMB data enhances the docs.
  // When absent, docgen works from the crawled HTML alone.
  requires: ["crawl"],
  produces: "docgen",

  async run(ctx: StageContext): Promise<StageResult> {
    const crawlStored = await loadArtifact<MirrorCrawlArtifact>(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "crawl",
    );
    if (!crawlStored) {
      throw new Error("No crawl artifact found — run the crawl stage first");
    }

    // Enrich (GMB) is optional — only present for real gym sign-ups, never for template builds
    const enrichStored = await loadArtifact<EnrichArtifact>(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "enrich",
    ).catch(() => null);

    const gmb = enrichStored?.payload.listing;
    if (gmb) {
      ctx.log(`  Building docs from crawl + GMB (${gmb.name})`);
    } else {
      ctx.log("  Building docs from crawl (no GMB data — template source)");
    }

    const scrapedFromCrawl = await buildScrapedWebsiteDataFromCrawl(
      crawlStored.payload,
      ctx.s3Client,
      ctx.config,
    );

    // Persist nav hierarchy to S3 so the generate stage can load it as capturedNav.
    // Written to sites/{uuid}/config/nav-structure.json — the highest-priority path
    // that generate checks first. Labels come directly from the source site HTML
    // (never hardcoded), so "Programs", "Our Beans", "Services", etc. all flow through.
    if (scrapedFromCrawl.navHierarchy && scrapedFromCrawl.navHierarchy.length > 0) {
      const navBucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;
      const navKey = `sites/${ctx.siteUuid}/config/nav-structure.json`;
      await ctx.s3Client.send(new PutObjectCommand({
        Bucket: navBucket,
        Key: navKey,
        Body: Buffer.from(JSON.stringify(scrapedFromCrawl.navHierarchy, null, 2), "utf8"),
        ContentType: "application/json; charset=utf-8",
      }));
      const topLabels = scrapedFromCrawl.navHierarchy.map(i => i.label).join(", ");
      ctx.log(`  Nav captured: ${topLabels}`);
    }

    // Fetch every page listed in the nav hierarchy directly from the source URL.
    // The crawl only captures the homepage because Webflow HTML links point to the
    // original Webflow domain, which the crawler treats as external. This step uses
    // the extracted nav as a URL list and fetches each page, saving content extracts
    // (iframes, headings, text) so the generate stage has real per-page data instead
    // of hallucinating content for pages it has never seen.
    {
      type PageExtract = {
        path: string;
        iframes: { src: string; height?: string; title?: string }[];
        headings: string[];
        paragraphs: string[];
      };
      const sourceBase = crawlStored.payload.sourceUrl.replace(/\/$/, "");
      const navItems = scrapedFromCrawl.navHierarchy ?? [];
      const allPaths = new Set<string>();
      for (const item of navItems) {
        if (item.href && item.href !== "/") allPaths.add(item.href);
        for (const child of (item.children ?? [])) {
          if (child.href && child.href !== "/") allPaths.add(child.href);
        }
      }

      if (allPaths.size > 0) {
        const extracts: Record<string, PageExtract> = {};
        for (const path of allPaths) {
          const url = `${sourceBase}${path}`;
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
            if (!res.ok) { ctx.log(`  [page-fetch] ${path}: ${res.status}`); continue; }
            const html = await res.text();
            const $ = cheerio.load(html);
            $("script, style, noscript").remove();

            const iframes = $("iframe[src]").map((_, el) => ({
              src: $(el).attr("src") ?? "",
              height: $(el).attr("height"),
              title: $(el).attr("title"),
            })).get().filter(i => i.src && !i.src.startsWith("javascript:"));

            const headings = $("h1, h2, h3").map((_, el) => $(el).text().trim()).get()
              .filter(Boolean).slice(0, 10);
            const paragraphs = $("p").map((_, el) => $(el).text().trim()).get()
              .filter(t => t.length > 30).slice(0, 8);

            extracts[path] = { path, iframes, headings, paragraphs };
            ctx.log(`  [page-fetch] ${path}: ${iframes.length} iframes, ${headings.length} headings`);
          } catch {
            ctx.log(`  [page-fetch] ${path}: fetch failed`);
          }
        }

        if (Object.keys(extracts).length > 0) {
          const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;
          await ctx.s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: `sites/${ctx.siteUuid}/config/page-extracts.json`,
            Body: Buffer.from(JSON.stringify(extracts, null, 2), "utf8"),
            ContentType: "application/json; charset=utf-8",
          }));
          ctx.log(`  Page extracts saved for: ${Object.keys(extracts).join(", ")}`);
        }
      }
    }

    // If the enrich stage produced a more complete ScrapedWebsiteData (it does
    // when GMB is applied), layer that on top of the cheerio parse so we keep
    // GMB facts but still have homepage headings/sections.
    // enrichStored is null for template builds — fall back to crawl data alone.
    const enrichedBase = enrichStored?.payload.data;
    const merged: ScrapedWebsiteData = enrichedBase ? {
      ...scrapedFromCrawl,
      ...enrichedBase,
      headings: scrapedFromCrawl.headings.length > 0 ? scrapedFromCrawl.headings : enrichedBase.headings,
      paragraphs: scrapedFromCrawl.paragraphs.length > 0 ? scrapedFromCrawl.paragraphs : enrichedBase.paragraphs,
      navLinks: scrapedFromCrawl.navLinks.length > 0 ? scrapedFromCrawl.navLinks : enrichedBase.navLinks,
      images: scrapedFromCrawl.images.length > 0 ? scrapedFromCrawl.images : enrichedBase.images,
      colors: scrapedFromCrawl.colors.length > 0 ? scrapedFromCrawl.colors : enrichedBase.colors,
      fonts: scrapedFromCrawl.fonts.length > 0 ? scrapedFromCrawl.fonts : enrichedBase.fonts,
      fontSizes: scrapedFromCrawl.fontSizes.length > 0 ? scrapedFromCrawl.fontSizes : enrichedBase.fontSizes,
      sections: scrapedFromCrawl.sections && scrapedFromCrawl.sections.length > 0
        ? scrapedFromCrawl.sections : enrichedBase.sections,
      contact: { ...scrapedFromCrawl.contact, ...enrichedBase.contact },
      locations: enrichedBase.locations.length > 0 ? enrichedBase.locations : scrapedFromCrawl.locations,
      testimonials: enrichedBase.testimonials.length > 0 ? enrichedBase.testimonials : scrapedFromCrawl.testimonials,
      offerings: enrichedBase.offerings.length > 0 ? enrichedBase.offerings : scrapedFromCrawl.offerings,
      team: enrichedBase.team.length > 0 ? enrichedBase.team : scrapedFromCrawl.team,
      faqs: enrichedBase.faqs.length > 0 ? enrichedBase.faqs : scrapedFromCrawl.faqs,
      layoutRules: scrapedFromCrawl.layoutRules.length > 0 ? scrapedFromCrawl.layoutRules : enrichedBase.layoutRules,
    } : scrapedFromCrawl;

    const data = mergeGmbIntoScraped(merged, gmb);

    // Pass undefined config/memoryCtx so generateSiteDocs does not run the LLM
    // business-info / workspace-memory extraction paths. GMB is the source of
    // truth for business facts now.
    const docs = await generateSiteDocs(data, gmb, undefined, undefined, null, "replication");

    await saveSiteDocs(ctx.db, ctx.workspaceUuid, docs, ctx.siteUuid);

    await saveArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "docgen",
      {
        docCount: docs.length,
        docKeys: docs.map((d) => d.key),
      },
    );

    ctx.log(`  Saved ${docs.length} docs:`);
    for (const doc of docs) {
      const preview = (doc.content ?? "").replace(/\n/g, " ").slice(0, 80);
      ctx.log(`    [${doc.key}] ${preview}`);
    }

    return {
      stage: "docgen",
      status: "pass",
      durationMs: 0,
      metrics: {
        docs: docs.length,
        keys: docs.map((d) => d.key).join(", "),
      },
      warnings: [],
    };
  },
};
