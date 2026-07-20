import type {
  ScrapedBrandInput,
  ScrapedColor,
  ScrapedFont,
  ScrapedImage,
  ScrapedLayoutRule,
  ScrapedTextStyle,
} from "@milo/shared-types";
import type { GmbListing } from "@milo/gmb-client";
import type { SectionVisualEvidenceRow } from "../types/section-visual-evidence";

export interface ScrapedSection {
  id: string;
  type: string;
  heading?: string;
  body?: string;
  address?: string;
  widgetUrl?: string;
  intent?: string;
  cta?: { label: string; href: string };
  visualEvidence: SectionVisualEvidenceRow;
  items?: { title?: string; description?: string; imageUrl?: string }[];
  images?: { url: string; alt?: string; context?: string }[];
  styleHint?: {
    theme?: "dark" | "light";
    centered?: boolean;
    columns?: number;
    imagePosition?: "left" | "right" | "background" | "none";
    sourceOrder?: number;
    align?: "left" | "center" | "right";
    eyebrow?: string;
    uppercase?: boolean;
    ctaStyle?: "primary" | "dark" | "outline";
    heroTextColor?: string;
    heroCtaBg?: string;
    heroCtaColor?: string;
    heroCtaRadius?: string;
    heroCtaHasIcon?: boolean;
    heroCtaUppercase?: boolean;
    heroCtaBold?: boolean;
    heroCtaTransform?: string;
    heroCtaPadding?: string;
    subtitleUppercase?: boolean;
    eyebrowBg?: string;
    eyebrowColor?: string;
    eyebrowPadding?: string;
  };
}

export interface ScrapedWebsiteData {
  url: string;
  title: string;
  description?: string;
  businessName?: string;
  tagline?: string;
  industry?: string;
  headings: string[];
  paragraphs: string[];
  buttons: string[];
  navLinks: { label: string; href: string }[];
  /** Full nav hierarchy extracted from source HTML — dropdowns preserved as children arrays. */
  navHierarchy?: { label: string; href: string; children?: { label: string; href: string }[] }[];
  colors: ScrapedColor[];
  fonts: ScrapedFont[];
  fontSizes: ScrapedTextStyle[];
  images: ScrapedImage[];
  layoutRules: ScrapedLayoutRule[];
  designTokens?: import("@milo/shared-types").ScrapedDesignToken[];
  faqs: { question: string; answer: string }[];
  testimonials: { quote: string; author?: string; role?: string }[];
  locations: { name?: string; address?: string; hours?: string }[];
  team: { name?: string; role?: string; bio?: string; photoUrl?: string }[];
  offerings: { name?: string; description?: string; price?: string }[];
  contact: { phone?: string; email?: string; social?: { platform: string; url: string }[] };
  sections?: ScrapedSection[];
  screenshotUrls?: string[];
  rawHtml?: string;
  /** Visual style of the header/menu CTA, if one exists. */
  headerCtaStyle?: {
    bg?: string;
    color?: string;
    radius?: string;
    padding?: string;
    uppercase?: boolean;
    bold?: boolean;
    light?: boolean;
    fontSize?: string;
  };
}

type NicheRule = {
  keywords: string[];
  base: string;
  niche: string;
};

const NICHE_RULES: NicheRule[] = [
  { keywords: ["crossfit"], base: "fitness / gym", niche: "CrossFit" },
  { keywords: ["brazilian jiu-jitsu", "bjj", "jiu jitsu", "grappling"], base: "fitness / gym", niche: "BJJ" },
  { keywords: ["muay thai", "kickboxing", "boxing"], base: "fitness / gym", niche: "Strike training" },
  { keywords: ["powerlifting", "strength training"], base: "fitness / gym", niche: "Strength training" },
  { keywords: ["olympic weightlifting", "oly"], base: "fitness / gym", niche: "Olympic weightlifting" },
  { keywords: ["personal training", "1-on-1"], base: "fitness / gym", niche: "Personal training" },
  { keywords: ["yoga"], base: "fitness studio", niche: "Yoga" },
  { keywords: ["pilates"], base: "fitness studio", niche: "Pilates" },
  { keywords: ["barre"], base: "fitness studio", niche: "Barre" },
  { keywords: ["cycling", "spin"], base: "fitness studio", niche: "Spin / indoor cycling" },
  { keywords: ["coffee", "cafe"], base: "restaurant", niche: "Coffee" },
  { keywords: ["restaurant"], base: "restaurant", niche: "Restaurant" },
];

function detectNiche(text: string): { base: string; niche: string } | undefined {
  const lower = text.toLowerCase();
  for (const rule of NICHE_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return { base: rule.base, niche: rule.niche };
    }
  }
  return undefined;
}

function detectBaseIndustry(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes("gym") || lower.includes("fitness") || lower.includes("crossfit")) {
    return "fitness / gym";
  }
  if (lower.includes("yoga") || lower.includes("pilates") || lower.includes("studio")) {
    return "fitness studio";
  }
  if (lower.includes("salon") || lower.includes("spa") || lower.includes("beauty")) {
    return "beauty / wellness";
  }
  if (lower.includes("restaurant") || lower.includes("cafe") || lower.includes("coffee")) {
    return "restaurant";
  }
  return "local business";
}

export function inferIndustry(text: string): string {
  const niche = detectNiche(text);
  if (niche) {
    return `${niche.base}: ${niche.niche}`;
  }
  return detectBaseIndustry(text);
}

function inferComponentPatterns(data: ScrapedWebsiteData): string[] {
  const patterns: string[] = [];
  if (data.navLinks.length > 0) {
    patterns.push(`Header navigation contains ${data.navLinks.length} links: ${data.navLinks.map((l) => l.label).join(", ")}.`);
  }
  if (data.offerings.length > 0) {
    patterns.push(`Services/pricing section with ${data.offerings.length} offerings in grid or card layout.`);
  }
  if (data.testimonials.length > 0) {
    patterns.push(`Testimonial section with ${data.testimonials.length} member quotes.`);
  }
  if (data.team.length > 0) {
    patterns.push(`Team/coach section with ${data.team.length} member profiles.`);
  }
  if (data.locations.length > 0) {
    patterns.push(`Location section with ${data.locations.length} locations.`);
  }
  if (data.faqs.length > 0) {
    patterns.push(`FAQ accordion with ${data.faqs.length} items.`);
  }
  if (data.designTokens && data.designTokens.length > 0) {
    const radius = data.designTokens.find((t) => t.category === "radius");
    if (radius) patterns.push(`Rounded interactive elements use ${radius.value} corner radius.`);
    const grid = data.designTokens.find((t) => t.category === "grid");
    if (grid) patterns.push(`Content grid: ${grid.value}.`);
  }
  return patterns;
}

function buildColorStrategy(colors: ScrapedColor[]): string {
  const bg = colors.find((c) => c.role === "background") ?? colors.find((c) => c.role === "surface");
  const accent = colors.find((c) => c.role === "accent");
  const text = colors.find((c) => c.role === "text");
  const parts: string[] = [];
  if (bg && text) {
    const luminance = detectLuminance(text.hex) > detectLuminance(bg.hex) ? "dark" : "light";
    parts.push(`The brand operates on a ${luminance}-mode canvas.`);
  }
  if (accent) {
    parts.push(`${accent.token} (${accent.hex}) is reserved for high-priority calls to action and interactive emphasis.`);
  }
  return parts.join(" ") || "Color strategy inferred from the captured palette.";
}

function buildPairingRules(colors: ScrapedColor[]): string[] {
  const text = colors.find((c) => c.role === "text") ?? colors.find((c) => c.role === "textMuted");
  const bg = colors.find((c) => c.role === "background") ?? colors.find((c) => c.role === "surface");
  const accent = colors.find((c) => c.role === "accent");
  const muted = colors.find((c) => c.role === "textMuted");
  const rules: string[] = [];
  if (text && bg) {
    rules.push(`Primary text (${text.hex}) is used for maximum contrast against the ${bg.hex} background.`);
  }
  if (muted) {
    rules.push(`Secondary metadata and descriptive text use ${muted.token} (${muted.hex}).`);
  }
  if (accent) {
    rules.push(`Accent color (${accent.hex}) is paired with neutral text for CTA readability.`);
  }
  return rules;
}

function buildContextRules(colors: ScrapedColor[]): string[] {
  const accent = colors.find((c) => c.role === "accent");
  const border = colors.find((c) => c.role === "border");
  const rules: string[] = [];
  if (accent) {
    rules.push(`${accent.token} fills primary buttons and key interactive surfaces.`);
  }
  if (border) {
    rules.push(`${border.token} (${border.hex}) defines structural borders, dividers, and outlined elements.`);
  }
  return rules;
}

function buildDarkModeBehavior(colors: ScrapedColor[]): string {
  const bg = colors.find((c) => c.role === "background") ?? colors.find((c) => c.role === "surface");
  if (!bg) return "No dominant background detected.";
  const isDark = detectLuminance(bg.hex) < 0.5;
  return isDark
    ? "The brand operates in a dark-first state; surfaces are dark with light text and accent highlights."
    : "The brand operates in a light-first state; surfaces are light with dark text and accent highlights.";
}

function detectLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return 0.5;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function buildImageryStrategy(data: ScrapedWebsiteData): string {
  const text = [data.tagline ?? "", ...data.headings.slice(0, 5), ...data.paragraphs.slice(0, 3)].join(" ").toLowerCase();
  if (text.includes("fitness") || text.includes("gym") || text.includes("crossfit")) {
    return "Action-oriented, high-contrast athletic photography with energetic composition and community energy.";
  }
  if (text.includes("yoga") || text.includes("pilates") || text.includes("wellness")) {
    return "Calm, lifestyle-focused imagery emphasizing movement, mindfulness, and welcoming studio spaces.";
  }
  if (text.includes("salon") || text.includes("spa") || text.includes("beauty")) {
    return "Clean, polished imagery with soft lighting and a premium, serene mood.";
  }
  return "Professional local-business photography matched to the brand's tone and service.";
}

function buildImagePlacement(data: ScrapedWebsiteData): string[] {
  const placements: string[] = [];
  const contexts = new Set(data.images.map((i) => i.context));
  if (contexts.has("hero")) placements.push("Full-bleed hero images with text overlay or adjacent headline.");
  if (contexts.has("product") || contexts.has("other")) placements.push("Supporting imagery in grid cards and alternating content sections.");
  if (contexts.has("team")) placements.push("Portrait-driven team section with consistent framing.");
  if (contexts.has("testimonial")) placements.push("Member or customer photos paired with quotes.");
  if (placements.length === 0) placements.push("Imagery distributed across content sections as backgrounds and inline visuals.");
  return placements;
}

function buildPromptKeywords(data: ScrapedWebsiteData): string[] {
  const text = [data.tagline ?? "", ...data.headings.slice(0, 5)].join(" ").toLowerCase();
  const keywords: string[] = [];
  if (text.includes("gym") || text.includes("fitness")) keywords.push("athletic", "high contrast", "fitness", "community");
  if (text.includes("crossfit")) keywords.push("barbells", "functional movement", "grit", "intensity");
  if (text.includes("yoga")) keywords.push("serene", "movement", "mindfulness", "natural light");
  const fromImages = data.images.flatMap((i) => i.promptKeywords ?? []);
  return [...new Set([...keywords, ...fromImages])].slice(0, 10);
}

function buildApplicationExamples(data: ScrapedWebsiteData): string[] {
  const examples: string[] = [];
  const accent = data.colors.find((c) => c.role === "accent");
  const radius = data.designTokens?.find((t) => t.category === "radius");
  const border = data.designTokens?.find((t) => t.category === "borderWidth");

  if (accent) {
    const shape = radius && !radius.value.includes("9999") ? ` and ${radius.value} rounded corners` : "";
    examples.push(`Primary CTAs use a full ${accent.token} fill with neutral text${shape}.`);
  }
  if (border) {
    examples.push(`Outlined cards, dividers, and secondary buttons use a ${border.value} border.`);
  }
  if (data.navLinks.length > 0) {
    examples.push(`Header navigation stays minimal, with ${data.navLinks.length} primary links.`);
  }
  if (data.offerings.length > 0) {
    examples.push(`Services section displays ${data.offerings.length} offerings in a consistent card format.`);
  }
  if (data.testimonials.length > 0) {
    examples.push(`Testimonials are presented as quote blocks with attribution.`);
  }
  if (data.faqs.length > 0) {
    examples.push(`FAQ sections use accordion rows separated by subtle borders.`);
  }
  return examples;
}

export interface BrandGuidelinesContext {
  scraped: ScrapedWebsiteData;
  gmb?: GmbListing;
}

export function buildBrandGuidelinesInput(ctx: BrandGuidelinesContext): ScrapedBrandInput {
  const { scraped, gmb } = ctx;
  const businessName = gmb?.name ?? scraped.businessName ?? scraped.title.replace(/\s*-.*$/, "").trim();
  const tagline = gmb?.editorialSummary ?? scraped.tagline;
  const industry = gmb?.primaryType
    ? inferIndustry(gmb.primaryType)
    : inferIndustry([scraped.description ?? "", ...scraped.headings.slice(0, 5), ...scraped.paragraphs.slice(0, 5)].join(" "));

  const gmbContextLines: string[] = [];
  if (gmb?.primaryType) gmbContextLines.push(`Google Business Profile category: ${gmb.primaryType}.`);
  if (gmb?.editorialSummary) gmbContextLines.push(`Business summary: ${gmb.editorialSummary}`);
  if (gmb?.photos?.length) gmbContextLines.push(`${gmb.photos.length} photos available from Google Business Profile.`);

  return {
    businessName,
    tagline,
    industry,
    description: scraped.description,
    colors: scraped.colors,
    colorStrategy: buildColorStrategy(scraped.colors),
    pairingRules: buildPairingRules(scraped.colors),
    contextRules: buildContextRules(scraped.colors),
    darkModeBehavior: buildDarkModeBehavior(scraped.colors),
    fonts: scraped.fonts,
    typeScale: scraped.fontSizes,
    toneKeywords: extractToneKeywords(ctx),
    toneExamples: [
      ...scraped.headings.slice(0, 8),
      ...scraped.buttons.slice(0, 8),
    ].filter((e, i, arr) => arr.indexOf(e) === i),
    imageryStrategy: buildImageryStrategy(scraped),
    imagePlacement: buildImagePlacement(scraped),
    promptKeywords: buildPromptKeywords(scraped),
    images: scraped.images,
    layoutRules: scraped.layoutRules,
    designTokens: scraped.designTokens,
    componentPatterns: inferComponentPatterns(scraped),
    applicationExamples: buildApplicationExamples(scraped),
    screenshotUrls: scraped.screenshotUrls,
  };
}

function extractToneKeywords(ctx: BrandGuidelinesContext): string[] {
  const { scraped, gmb } = ctx;
  const text = [
    gmb?.editorialSummary ?? "",
    scraped.tagline ?? "",
    ...scraped.headings,
    ...scraped.buttons,
  ].join(" ").toLowerCase();
  const keywords: string[] = [];
  const checks: Record<string, string[]> = {
    direct: ["book", "join", "start", "get", "free"],
    inclusive: ["community", "everyone", "together", "no matter"],
    premium: ["premium", "elite", "exclusive", "private"],
    playful: ["fun", "love", "enjoy", "vibe"],
    gritty: ["push", "sweat", "grind", "work"],
    technical: ["form", "technique", "coach", "programming"],
  };
  for (const [tone, words] of Object.entries(checks)) {
    if (words.some((w) => text.includes(w))) {
      keywords.push(tone);
    }
  }
  if (keywords.length === 0) {
    keywords.push("direct", "action-oriented");
  }
  return keywords;
}
