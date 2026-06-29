import type {
  ScrapedBrandInput,
  ScrapedColor,
  ScrapedFont,
  ScrapedImage,
  ScrapedLayoutRule,
  ScrapedTextStyle,
} from "@ploy-gyms/shared-types";

export interface ScrapedWebsiteData {
  url: string;
  title: string;
  description?: string;
  businessName?: string;
  tagline?: string;
  headings: string[];
  paragraphs: string[];
  buttons: string[];
  navLinks: { label: string; href: string }[];
  colors: ScrapedColor[];
  fonts: ScrapedFont[];
  fontSizes: ScrapedTextStyle[];
  images: ScrapedImage[];
  layoutRules: ScrapedLayoutRule[];
  faqs: { question: string; answer: string }[];
  testimonials: { quote: string; author?: string; role?: string }[];
  locations: { name?: string; address?: string; hours?: string }[];
  team: { name?: string; role?: string; bio?: string }[];
  offerings: { name?: string; description?: string; price?: string }[];
  contact: { phone?: string; email?: string; social?: { platform: string; url: string }[] };
  screenshotUrls?: string[];
}

function inferIndustry(text: string): string {
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
  return "local business";
}

function inferComponentPatterns(data: ScrapedWebsiteData): string[] {
  const patterns: string[] = [];
  if (data.navLinks.length > 0) {
    patterns.push(`Header navigation contains ${data.navLinks.length} links: ${data.navLinks.map((l) => l.label).join(", ")}.`);
  }
  if (data.faqs.length > 0) {
    patterns.push(`FAQ accordion with ${data.faqs.length} items.`);
  }
  if (data.testimonials.length > 0) {
    patterns.push(`Testimonial section with ${data.testimonials.length} quotes.`);
  }
  if (data.locations.length > 0) {
    patterns.push(`Location section with ${data.locations.length} locations.`);
  }
  if (data.team.length > 0) {
    patterns.push(`Team/coach section with ${data.team.length} members.`);
  }
  if (data.offerings.length > 0) {
    patterns.push(`Services/pricing section with ${data.offerings.length} offerings.`);
  }
  return patterns;
}

export function buildBrandGuidelinesInput(data: ScrapedWebsiteData): ScrapedBrandInput {
  const businessName = data.businessName ?? data.title.replace(/\s*-.*$/, "").trim();
  const industry = inferIndustry(
    [data.description ?? "", ...data.headings.slice(0, 5), ...data.paragraphs.slice(0, 5)].join(" "),
  );

  return {
    businessName,
    tagline: data.tagline,
    industry,
    description: data.description,
    colors: data.colors,
    fonts: data.fonts,
    typeScale: data.fontSizes,
    toneKeywords: extractToneKeywords(data),
    toneExamples: data.buttons.slice(0, 5).concat(data.headings.slice(0, 3)),
    images: data.images,
    layoutRules: data.layoutRules,
    componentPatterns: inferComponentPatterns(data),
    screenshotUrls: data.screenshotUrls,
  };
}

function extractToneKeywords(data: ScrapedWebsiteData): string[] {
  const text = [data.tagline ?? "", ...data.headings, ...data.buttons].join(" ").toLowerCase();
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
