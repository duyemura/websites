import { getPlaceDetails, searchPlaces, type GmbListing } from "@milo/gmb-client";
import type { ScrapedWebsiteData } from "./scrape-docs";

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function domainsMatch(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const cleanA = hostnameFromUrl(a.startsWith("http") ? a : `https://${a}`);
  const cleanB = hostnameFromUrl(b.startsWith("http") ? b : `https://${b}`);
  return cleanA === cleanB && cleanA.length > 0;
}

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function wordOverlap(a: string, b: string): number {
  const setA = new Set(normalizeWords(a));
  const setB = new Set(normalizeWords(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  return intersection / Math.max(setA.size, setB.size);
}

function hostWordOverlap(listingName: string, targetHostname: string): number {
  const hostRoot = targetHostname.replace(/^www\./, "").split(".")[0] ?? "";
  const hostWords = normalizeWords(hostRoot);
  const listingWords = normalizeWords(listingName);
  if (hostWords.length === 0) return 0;
  return listingWords.filter((w) => hostWords.includes(w)).length / hostWords.length;
}

function isStrongGmbMatch(listing: GmbListing, targetHostname: string, scrapedName: string): boolean {
  if (domainsMatch(listing.websiteUri, targetHostname)) return true;
  if (wordOverlap(listing.name, scrapedName) >= 0.5) return true;
  if (hostWordOverlap(listing.name, targetHostname) >= 0.5) return true;
  return false;
}

function pickBestListing(listings: GmbListing[], targetHostname: string): GmbListing | undefined {
  if (listings.length === 0) return undefined;
  if (listings.length === 1) return listings[0];

  // Prefer a result whose website matches the scraped domain.
  const matchingWebsite = listings.find((l) => domainsMatch(l.websiteUri, targetHostname));
  if (matchingWebsite) return matchingWebsite;

  return listings[0];
}

function formatAddress(listing: GmbListing): string | undefined {
  const { address } = listing;
  if (!address) return undefined;
  const street = [address.streetNumber, address.streetName].filter(Boolean).join(" ");
  const cityState = [address.city, address.state].filter(Boolean).join(", ");
  const parts = [street, cityState, address.postalCode, address.country].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function formatHours(hours: { day: string; open?: string; close?: string; isClosed?: boolean }[]): string {
  return hours
    .map((h) => {
      const label = h.day.charAt(0) + h.day.slice(1).toLowerCase();
      if (h.isClosed || !h.open) return `${label}: Closed`;
      const close = h.close ?? "—";
      return `${label}: ${h.open}–${close}`;
    })
    .join("\n");
}

export interface GmbEnrichmentResult {
  listing?: GmbListing;
  applied: boolean;
}

/**
 * Extracts the most authoritative facts from a GMB listing into a
 * normalized shape the doc generators can use as a first-class source.
 */
export function extractGmbSource(listing: GmbListing): {
  businessName: string;
  address?: string;
  hours?: string;
  phone?: string;
  website?: string;
  googleMapsUri?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  editorialSummary?: string;
  reviews: GmbListing["reviews"];
  photos: GmbListing["photos"];
} {
  return {
    businessName: listing.name,
    address: formatAddress(listing),
    hours: listing.regularOpeningHours?.length
      ? formatHours(listing.regularOpeningHours)
      : undefined,
    phone: listing.phoneNumber,
    website: listing.websiteUri,
    googleMapsUri: listing.googleMapsUri,
    category: listing.primaryType,
    rating: listing.rating,
    reviewCount: listing.userRatingCount,
    editorialSummary: listing.editorialSummary,
    reviews: listing.reviews,
    photos: listing.photos,
  };
}

export async function enrichWithGmb(
  data: ScrapedWebsiteData,
  apiKey: string,
): Promise<{ data: ScrapedWebsiteData; result: GmbEnrichmentResult }> {
  const targetHostname = hostnameFromUrl(data.url);
  const query = data.businessName && data.businessName.length > 2 ? `${data.businessName} ${targetHostname}` : targetHostname;

  let listings: GmbListing[] = [];
  try {
    const search = await searchPlaces(query, apiKey, { pageSize: 5 });
    listings = search.places;
  } catch {
    // Search failed; fall through to empty result.
  }

  let listing = pickBestListing(listings, targetHostname);

  // If the search returned a match without reviews, fetch full details.
  if (listing && listing.reviews.length === 0) {
    try {
      listing = await getPlaceDetails(listing.placeId, apiKey);
    } catch {
      // Keep the search result if details fail.
    }
  }

  if (!listing || !isStrongGmbMatch(listing, targetHostname, data.businessName ?? "")) {
    return { data, result: { applied: false } };
  }

  const enriched: ScrapedWebsiteData = { ...data };

  // Business name: GMB is authoritative.
  if (listing.name && listing.name.length > 1) {
    enriched.businessName = listing.name;
  }

  // Phone number.
  if (listing.phoneNumber) {
    enriched.contact = { ...enriched.contact, phone: listing.phoneNumber };
  }

  // Address and hours as the primary location.
  const gmbAddress = formatAddress(listing);
  if (gmbAddress || listing.regularOpeningHours?.length) {
    const existingPrimary = enriched.locations[0] ?? {};
    enriched.locations = [
      {
        ...existingPrimary,
        name: existingPrimary.name ?? listing.name,
        address: gmbAddress ?? existingPrimary.address,
        hours: listing.regularOpeningHours?.length
          ? formatHours(listing.regularOpeningHours)
          : existingPrimary.hours,
      },
      ...enriched.locations.slice(1),
    ];
  }

  // Category refines the industry if we didn't detect a fitness-specific one.
  if (listing.primaryType) {
    const lower = listing.primaryType.toLowerCase();
    if (!enriched.industry || enriched.industry === "local business") {
      if (lower.includes("gym") || lower.includes("fitness")) {
        enriched.industry = "fitness / gym";
      } else if (lower.includes("yoga") || lower.includes("pilates") || lower.includes("studio")) {
        enriched.industry = "fitness studio";
      } else {
        enriched.industry = listing.primaryType;
      }
    }
  }

  // Editorial summary improves the tagline/description if we lack good copy.
  if (listing.editorialSummary && (!enriched.tagline || enriched.tagline.length < 30)) {
    enriched.tagline = listing.editorialSummary;
  }

  // Reviews become testimonials if we didn't find any.
  if (enriched.testimonials.length === 0 && listing.reviews.length > 0) {
    enriched.testimonials = listing.reviews.map((r) => ({
      quote: r.text ?? "",
      author: r.author,
      role: undefined,
    }));
  }

  // GMB photos are available on the listing for later server-side curation.
  // We do NOT materialize key-bearing URLs into persisted scraped data; doing
  // so would leak the Places API key into docs, blueprints, and rendered sites.
  // Asset pipeline should fetch them via fetchPhotoMedia() and upload to S3.

  return { data: enriched, result: { listing, applied: true } };
}
