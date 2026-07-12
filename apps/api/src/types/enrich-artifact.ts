import type { GmbListing } from "@ploy-gyms/gmb-client";
import type { ScrapedWebsiteData } from "../utils/scrape-docs";

export interface EnrichArtifact {
  enrichedAt: string;
  sourceUrl: string;
  applied: boolean;
  /** Authoritative GMB listing, when a strong match was found. */
  listing?: GmbListing;
  /** Scraper-shaped data after GMB enrichment (useful for doc generators). */
  data: ScrapedWebsiteData;
}
