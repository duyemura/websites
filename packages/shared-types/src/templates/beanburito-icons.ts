// Beanburito theme icon library.
//
// We use the Phosphor icon web font (bold weight) so every icon is a real,
// consistent glyph. The template spec asks the LLM to pick a Phosphor icon name
// for each value prop and amenity; we keep a small deterministic fallback map
// for content that doesn't specify an explicit icon.
//
// Icon names are Phosphor's kebab-case class names (without the `ph-` prefix),
// e.g. "barbell", "users", "calendar-check". The renderer emits
// `<i class="ph-bold ph-{name}"></i>`.
//
// This module is exported by @milo/shared-types so both the renderer and
// the API's generate-content stage share the same icon set and validation.

export const GYM_ICON_CATEGORIES: Record<string, string> = {
  // Training / programs
  "personal training": "barbell",
  "private training": "barbell",
  "one-on-one": "barbell",
  "1-on-1": "barbell",
  "group strength": "barbell",
  "strength": "barbell",
  "crossfit": "barbell",
  "cross-train": "barbell",
  "bootcamp": "barbell",
  "hiit": "lightning",
  "conditioning": "lightning",
  "workout": "barbell",
  "fitness": "barbell",
  "exercise": "barbell",
  "dumbbell": "barbell",

  // Coaching / guidance
  coaching: "user-gear",
  trainer: "user-gear",
  coach: "user-gear",
  expert: "user-gear",
  guidance: "compass",
  plan: "notepad",
  personalized: "fingerprint",
  tailored: "fingerprint",
  program: "notepad",

  // Goals / results
  goal: "target",
  achieve: "target",
  result: "chart-line-up",
  transform: "arrows-out",
  success: "trophy",
  milestone: "flag",

  // Scheduling
  "drop-in": "calendar-check",
  class: "calendar-check",
  schedule: "calendar",
  booking: "calendar-check",
  reservation: "calendar-check",
  reserve: "calendar-check",
  appointment: "calendar-check",
  session: "clock",
  visit: "door",
  tour: "door",
  weekend: "calendar",
  hours: "clock",

  // Community / people
  community: "users",
  people: "users",
  support: "hands-helping",
  belong: "users-three",
  team: "users",
  family: "users",

  // Amenities / facilities
  water: "drop",
  hydration: "drop",
  nutrition: "carrot",
  diet: "carrot",
  meal: "fork-knife",
  food: "fork-knife",
  app: "device-mobile",
  mobile: "device-mobile",
  phone: "phone",
  wifi: "wifi-high",
  internet: "wifi-high",
  senior: "heart-beat",
  "over 50": "heart-beat",
  locker: "lockers",
  shower: "shower",
  changing: "t-shirt",
  restroom: "toilet",
  parking: "car",
  equipment: "barbell",
  facility: "buildings",
  gym: "barbell",
  space: "squares-four",

  // Safety / trust
  safe: "shield-check",
  certified: "seal-check",
  insured: "shield-check",
  clean: "broom",

  // Default
  default: "star",
};

export const KNOWN_PHOSPHOR_ICONS = new Set([
  "barbell", "lightning", "user-gear", "compass", "notepad", "fingerprint", "target",
  "chart-line-up", "arrows-out", "trophy", "flag", "calendar-check", "calendar", "clock",
  "door", "users", "hands-helping", "users-three", "drop", "carrot", "fork-knife",
  "device-mobile", "phone", "wifi-high", "heart-beat", "lockers", "shower", "t-shirt",
  "toilet", "car", "buildings", "squares-four", "shield-check", "seal-check", "broom",
  "star", "heartbeat", "heart", "medal", "check", "x", "info", "warning", "question",
  "arrow-right", "arrow-left", "arrow-up", "arrow-down", "caret-right", "caret-left",
  "caret-up", "caret-down", "magnifying-glass", "list", "menu", "house", "map-pin",
  "envelope", "chat-circle", "chat-teardrop", "share-network", "facebook-logo",
  "instagram-logo", "youtube-logo", "tiktok-logo", "twitter-logo",
]);

/** Validate that a name is a known Phosphor icon. Unknown names fall back to "star". */
export function validateIcon(name: string | undefined): string {
  if (!name) return "star";
  const normalized = name.toLowerCase().trim().replace(/^ph-/, "");
  return KNOWN_PHOSPHOR_ICONS.has(normalized) ? normalized : "star";
}

/** Resolve a meaningful icon from a label/headline. Uses explicitIcon if provided, otherwise maps by keyword. */
export function resolveIcon(text: string, explicitIcon?: string): string {
  if (explicitIcon) return validateIcon(explicitIcon);
  const t = text.toLowerCase();
  for (const [phrase, icon] of Object.entries(GYM_ICON_CATEGORIES)) {
    if (t.includes(phrase)) return icon;
  }
  return "star";
}

/** @deprecated Use resolveIcon instead. */
export const iconFor = resolveIcon;

/** Build a Phosphor icon element with the given size in pixels. */
export function iconHtml(name: string, size = 64): string {
  const valid = validateIcon(name);
  return `<i class="ph-bold ph-${valid}" style="font-size:${size}px;line-height:1;vertical-align:middle"></i>`;
}
