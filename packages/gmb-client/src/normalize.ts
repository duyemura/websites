import type { GmbAddress, GmbHours, GmbListing, GmbPhoto, GmbReview } from "./types";

const DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function normalizeAddress(addressComponents?: unknown[]): GmbAddress {
  const result: GmbAddress = {};
  if (!Array.isArray(addressComponents)) return result;

  for (const component of addressComponents) {
    const c = component as Record<string, unknown>;
    const types = (c.types as string[]) ?? [];
    const text = (c.longText as string) || (c.shortText as string) || "";
    if (types.includes("street_number")) result.streetNumber = text;
    if (types.includes("route")) result.streetName = text;
    if (types.includes("locality")) result.city = text;
    if (types.includes("administrative_area_level_1")) result.state = text;
    if (types.includes("country")) result.country = text;
    if (types.includes("postal_code")) result.postalCode = text;
  }

  return result;
}

interface PeriodPoint {
  day?: number;
  hour?: number;
  minute?: number;
}

function normalizeHours(periods?: unknown[]): GmbHours[] {
  if (!Array.isArray(periods)) return [];
  return periods.map((period) => {
    const p = period as Record<string, unknown>;
    const open = p.open as PeriodPoint | undefined;
    const close = p.close as PeriodPoint | undefined;
    const openDay = DAYS[Number(open?.day) ?? -1];

    const formatTime = (t?: PeriodPoint) =>
      t == null
        ? undefined
        : `${String(t.hour ?? 0).padStart(2, "0")}:${String(t.minute ?? 0).padStart(2, "0")}`;

    return {
      day: openDay ?? "",
      open: formatTime(open),
      close: formatTime(close),
      isOpen24Hours:
        open?.day === close?.day && open?.hour === 0 && open?.minute === 0 && close?.hour === 23 && close?.minute === 59,
      isClosed: open == null,
    };
  });
}

function normalizePhotos(photos?: unknown[]): GmbPhoto[] {
  if (!Array.isArray(photos)) return [];
  return photos.map((photo) => {
    const p = photo as Record<string, unknown>;
    return {
      name: (p.name as string) || "",
      url: (p.googleMapsUri as string) || "",
      heightPx: p.heightPx as number | undefined,
      widthPx: p.widthPx as number | undefined,
      authorAttributions: Array.isArray(p.authorAttributions)
        ? p.authorAttributions.map((a: unknown) => ({
            displayName: (a as Record<string, unknown>).displayName as string | undefined,
            uri: (a as Record<string, unknown>).uri as string | undefined,
          }))
        : [],
    };
  });
}

function normalizeReviews(reviews?: unknown[]): GmbReview[] {
  if (!Array.isArray(reviews)) return [];
  return reviews.slice(0, 10).map((review) => {
    const r = review as Record<string, unknown>;
    const author = r.authorAttribution as { displayName?: string } | undefined;
    return {
      name: (r.name as string) || "",
      rating: Number(r.rating) || 0,
      text: (r.text as { text?: string })?.text || (r.text as string) || undefined,
      publishTime: (r.publishTime as string) || undefined,
      author: author?.displayName,
    };
  });
}

export function normalizePlace(raw: Record<string, unknown>): GmbListing {
  const loc = raw.location as { latitude?: number; longitude?: number } | undefined;
  return {
    placeId: (raw.id as string) || "",
    name: (raw.displayName as { text?: string })?.text || (raw.displayName as string) || "",
    primaryType: (raw.primaryTypeDisplayName as { text?: string })?.text || (raw.primaryType as string) || undefined,
    types: Array.isArray(raw.types) ? raw.types.map(String) : [],
    address: normalizeAddress(raw.addressComponents as unknown[]),
    location: loc?.latitude != null && loc?.longitude != null
      ? { lat: loc.latitude, lng: loc.longitude }
      : undefined,
    phoneNumber: (raw.nationalPhoneNumber as string) || (raw.internationalPhoneNumber as string) || undefined,
    websiteUri: (raw.websiteUri as string) || undefined,
    googleMapsUri: (raw.googleMapsUri as string) || undefined,
    rating: raw.rating != null ? Number(raw.rating) : undefined,
    userRatingCount: raw.userRatingCount != null ? Number(raw.userRatingCount) : undefined,
    priceLevel: (raw.priceLevel as string) || undefined,
    editorialSummary: (raw.editorialSummary as { text?: string })?.text || undefined,
    regularOpeningHours: normalizeHours((raw.regularOpeningHours as { periods?: unknown[] })?.periods),
    photos: normalizePhotos(raw.photos as unknown[]),
    reviews: normalizeReviews(raw.reviews as unknown[]),
    businessStatus: (raw.businessStatus as string) || undefined,
    isOpen: raw.regularOpeningHours ? (raw.regularOpeningHours as { openNow?: boolean }).openNow : undefined,
    utcOffsetMinutes: raw.utcOffsetMinutes != null ? Number(raw.utcOffsetMinutes) : undefined,
    iconMaskBaseUri: (raw.iconMaskBaseUri as string) || undefined,
    iconBackgroundColor: (raw.iconBackgroundColor as string) || undefined,
  };
}
