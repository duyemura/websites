// Canonical baseline for every gym website template in the Milo system.
// Templates are intentionally style-adjustable, but they must all start from the
// same neutral default tokens, placeholder text, and placeholder images so that
// previews and freshly imported shells look identical until brand values are applied.
//
// Rule: a template may only override these values with data extracted from the
// source site or supplied by the workspace. Do not invent template-specific colors,
// fonts, imagery, or copy.

import type { ThemeTokens } from "./theme.js";
import type { BrandTokens, BusinessInfo } from "./gym-content.js";

export const DEFAULT_TEMPLATE_TOKENS: ThemeTokens = {
  colors: {
    primary: "#111111",
    primaryForeground: "#ffffff",
    background: "#ffffff",
    foreground: "#171717",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    border: "#e5e5e5",
  },
  fonts: {
    heading: "Inter",
    body: "Inter",
  },
  radius: "0.5rem",
};

export const DEFAULT_BUSINESS_NAME = "Your Gym Name";
export const DEFAULT_CITY = "Your City";
export const DEFAULT_STATE = "Your State";
export const DEFAULT_STATE_ABBR = "YS";
export const DEFAULT_TAGLINE = `${DEFAULT_BUSINESS_NAME} offers group strength, cardio bootcamp, and personal training in ${DEFAULT_CITY}, ${DEFAULT_STATE_ABBR} serving adults of all fitness levels.`;

export const DEFAULT_PROGRAMS = [
  { slug: "group-strength", name: "Group Strength" },
  { slug: "cardio-bootcamp", name: "Cardio Bootcamp" },
  { slug: "personal-training", name: "Personal Training" },
] as const;

export const DEFAULT_BUSINESS_PLACEHOLDER: Omit<BusinessInfo, "hours"> = {
  name: DEFAULT_BUSINESS_NAME,
  tagline: DEFAULT_TAGLINE,
  address: {
    street: "123 Main St",
    city: DEFAULT_CITY,
    state: DEFAULT_STATE,
    zip: "00000",
  },
  phone: "(000) 000-0000",
  email: "hello@example.com",
  primaryCta: { label: "Free consultation", url: "/contact" },
  trialCta: { label: "Start your free trial", url: "/pricing" },
  geo: { city: DEFAULT_CITY, state: DEFAULT_STATE, stateAbbr: DEFAULT_STATE_ABBR },
  serviceArea: ["Nearby City 1", "Nearby City 2", "Nearby City 3", "Nearby City 4"],
  aggregateRating: { ratingValue: "4.9", reviewCount: 127 },
  social: {
    facebook: "https://facebook.com/yourgym",
    instagram: "https://instagram.com/yourgym",
    youtube: "https://youtube.com/@yourgym",
  },
};

import { NO_IMAGE } from "./gym-content.js";

/**
 * Sentinel for "use a plain HTML/CSS background instead of an image".
 * Exported from gym-content.ts and re-exported here for backwards compatibility.
 */
export { NO_IMAGE };

/** Placehold.co label for a generic image. Prefer plain ASCII labels so the URL stays readable. */
export const placeholderImage = (label: string, width = 800, height = 600): string =>
  `https://placehold.co/${width}x${height}?text=${encodeURIComponent(label).replace(/%20/g, "+")}`;

/** Program names that generic gym templates use by default. */
export const defaultProgramName = (slug: string): string =>
  DEFAULT_PROGRAMS.find((p) => p.slug === slug)?.name ?? slug;

export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  primaryColor: DEFAULT_TEMPLATE_TOKENS.colors.primary,
  secondaryColor: DEFAULT_TEMPLATE_TOKENS.colors.foreground,
  accentColor: DEFAULT_TEMPLATE_TOKENS.colors.mutedForeground,
  headingFont: DEFAULT_TEMPLATE_TOKENS.fonts.heading,
  bodyFont: DEFAULT_TEMPLATE_TOKENS.fonts.body,
  logoUrl: NO_IMAGE,
  logoAlt: DEFAULT_BUSINESS_NAME,
};
