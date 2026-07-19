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

    // If the enrich stage produced a more complete ScrapedWebsiteData (it does
    // when GMB is applied), layer that on top of the cheerio parse so we keep
    // GMB facts but still have homepage headings/sections.
    const enrichedBase = enrichStored.payload.data;
    const merged: ScrapedWebsiteData = {
      ...scrapedFromCrawl,
      ...enrichedBase,
      // Preserve parsed arrays when the enrich data left them empty.
      headings: scrapedFromCrawl.headings.length > 0 ? scrapedFromCrawl.headings : enrichedBase.headings,
      paragraphs: scrapedFromCrawl.paragraphs.length > 0 ? scrapedFromCrawl.paragraphs : enrichedBase.paragraphs,
      navLinks: scrapedFromCrawl.navLinks.length > 0 ? scrapedFromCrawl.navLinks : enrichedBase.navLinks,
      images: scrapedFromCrawl.images.length > 0 ? scrapedFromCrawl.images : enrichedBase.images,
      colors: scrapedFromCrawl.colors.length > 0 ? scrapedFromCrawl.colors : enrichedBase.colors,
      fonts: scrapedFromCrawl.fonts.length > 0 ? scrapedFromCrawl.fonts : enrichedBase.fonts,
      fontSizes: scrapedFromCrawl.fontSizes.length > 0 ? scrapedFromCrawl.fontSizes : enrichedBase.fontSizes,
      sections: scrapedFromCrawl.sections && scrapedFromCrawl.sections.length > 0
        ? scrapedFromCrawl.sections
        : enrichedBase.sections,
      contact: { ...scrapedFromCrawl.contact, ...enrichedBase.contact },
      locations: enrichedBase.locations.length > 0 ? enrichedBase.locations : scrapedFromCrawl.locations,
      testimonials: enrichedBase.testimonials.length > 0 ? enrichedBase.testimonials : scrapedFromCrawl.testimonials,
      offerings: enrichedBase.offerings.length > 0 ? enrichedBase.offerings : scrapedFromCrawl.offerings,
      team: enrichedBase.team.length > 0 ? enrichedBase.team : scrapedFromCrawl.team,
      faqs: enrichedBase.faqs.length > 0 ? enrichedBase.faqs : scrapedFromCrawl.faqs,
      layoutRules: scrapedFromCrawl.layoutRules.length > 0 ? scrapedFromCrawl.layoutRules : enrichedBase.layoutRules,
    };

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
