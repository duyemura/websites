import type { GmbListing, SearchPlacesOptions } from "./types";
import { normalizePlace } from "./normalize";

const PLACES_BASE_URL = "https://places.googleapis.com/v1";

const PLACE_DETAILS_FIELDS = [
  "id",
  "displayName",
  "primaryType",
  "primaryTypeDisplayName",
  "types",
  "addressComponents",
  "formattedAddress",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "googleMapsUri",
  "rating",
  "userRatingCount",
  "priceLevel",
  "editorialSummary",
  "regularOpeningHours",
  "photos",
  "reviews",
  "businessStatus",
  "iconMaskBaseUri",
  "iconBackgroundColor",
  "utcOffsetMinutes",
].join(",");

const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.addressComponents",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.editorialSummary",
  "places.regularOpeningHours",
  "places.photos",
  "places.reviews",
  "places.businessStatus",
  "places.iconMaskBaseUri",
  "places.iconBackgroundColor",
  "places.utcOffsetMinutes",
].join(",");

class GmbClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response: unknown,
  ) {
    super(message);
    this.name = "GmbClientError";
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => undefined)) as unknown;

  if (!response.ok) {
    const message =
      (body && typeof body === "object" && "error" in body
        ? (body.error as { message?: string }).message
        : undefined) || `Google Places API returned ${response.status}`;
    throw new GmbClientError(message, response.status, body);
  }

  return body;
}

export interface SearchPlacesResult {
  places: GmbListing[];
  nextPageToken?: string;
}

export async function searchPlaces(
  query: string,
  apiKey: string,
  options: SearchPlacesOptions = {},
): Promise<SearchPlacesResult> {
  const body: Record<string, unknown> = {
    textQuery: query,
    languageCode: options.languageCode ?? "en",
    regionCode: options.regionCode ?? "US",
    pageSize: Math.min(Math.max(options.pageSize ?? 5, 1), 20),
  };

  if (options.includedType) {
    body.includedType = options.includedType;
  }

  if (options.locationBias) {
    body.locationBias = {
      circle: {
        center: {
          latitude: options.locationBias.latitude,
          longitude: options.locationBias.longitude,
        },
        radius: options.locationBias.radius ?? 50000,
      },
    };
  }

  const result = (await fetchJson(`${PLACES_BASE_URL}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELDS,
    },
    body: JSON.stringify(body),
  })) as Record<string, unknown>;

  const rawPlaces = Array.isArray(result.places) ? result.places : [];
  return {
    places: rawPlaces.map((p) => normalizePlace(p as Record<string, unknown>)),
    nextPageToken: (result.nextPageToken as string) || undefined,
  };
}

export async function getPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<GmbListing> {
  const cleanId = placeId.replace(/^places\//, "");
  const result = (await fetchJson(
    `${PLACES_BASE_URL}/places/${cleanId}?key=${encodeURIComponent(apiKey)}`,
    {
      method: "GET",
      headers: {
        "X-Goog-FieldMask": PLACE_DETAILS_FIELDS,
      },
    },
  )) as Record<string, unknown>;

  return normalizePlace(result);
}

export function getPhotoMediaUrl(
  photoName: string,
  apiKey: string,
  options: { maxHeightPx?: number; maxWidthPx?: number } = {},
): string {
  const params = new URLSearchParams({ key: apiKey });
  if (options.maxHeightPx) params.set("maxHeightPx", String(options.maxHeightPx));
  if (options.maxWidthPx) params.set("maxWidthPx", String(options.maxWidthPx));
  return `${PLACES_BASE_URL}/${photoName}/media?${params.toString()}`;
}

export * from "./types";
export { normalizePlace } from "./normalize";
