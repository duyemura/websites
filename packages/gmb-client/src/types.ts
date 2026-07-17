export interface GmbAddress {
  streetNumber?: string;
  streetName?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  fullAddress?: string;
}

export interface GmbHours {
  day: string;
  open?: string;
  close?: string;
  isOpen24Hours?: boolean;
  isClosed?: boolean;
}

export interface GmbPhoto {
  name: string;
  url: string;
  heightPx?: number;
  widthPx?: number;
  authorAttributions?: Array<{ displayName?: string; uri?: string }>;
}

export interface GmbReview {
  name: string;
  rating: number;
  text?: string;
  publishTime?: string;
  author?: string;
}

export interface GmbListing {
  placeId: string;
  name: string;
  primaryType?: string;
  types: string[];
  address: GmbAddress;
  /** Geographic coordinates from the Places API `location` field. */
  location?: { lat: number; lng: number };
  phoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  editorialSummary?: string;
  regularOpeningHours?: GmbHours[];
  photos: GmbPhoto[];
  reviews: GmbReview[];
  businessStatus?: string;
  isOpen?: boolean;
  utcOffsetMinutes?: number;
  iconMaskBaseUri?: string;
  iconBackgroundColor?: string;
}

export interface SearchPlacesOptions {
  locationBias?: { latitude: number; longitude: number; radius?: number };
  includedType?: string;
  languageCode?: string;
  regionCode?: string;
  pageSize?: number;
}
