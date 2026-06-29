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
  industry?: string;
  headings: string[];
  paragraphs: string[];
  buttons: string[];
  navLinks: { label: string; href: string }[];
  colors: ScrapedColor[];
  fonts: ScrapedFont[];
  fontSizes: ScrapedTextStyle[];
  images: ScrapedImage[];
  layoutRules: ScrapedLayoutRule[];
  designTokens?: import("@ploy-gyms/shared-types").ScrapedDesignToken[];
  faqs: { question: string; answer: string }[];
  testimonials: { quote: string; author?: string; role?: string }[];
  locations: { name?: string; address?: string; hours?: string }[];
  team: { name?: string; role?: string; bio?: string }[];
  offerings: { name?: string; description?: string; price?: string }[];
  contact: { phone?: string; email?: string; social?: { platform: string; url: string }[] };
  screenshotUrls?: string[];
  rawHtml?: string;
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
  return parts.join(" ") || "Color strategy inferred from the palette below.";
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
  return "Professional local-business photography matched to the brand’s tone and service.";
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
    colorStrategy: buildColorStrategy(data.colors),
    pairingRules: buildPairingRules(data.colors),
    contextRules: buildContextRules(data.colors),
    darkModeBehavior: buildDarkModeBehavior(data.colors),
    fonts: data.fonts,
    typeScale: data.fontSizes,
    toneKeywords: extractToneKeywords(data),
    toneExamples: [
      ...data.headings.slice(0, 8),
      ...data.buttons.slice(0, 8),
    ].filter((e, i, arr) => arr.indexOf(e) === i),
    imageryStrategy: buildImageryStrategy(data),
    imagePlacement: buildImagePlacement(data),
    promptKeywords: buildPromptKeywords(data),
    images: data.images,
    layoutRules: data.layoutRules,
    designTokens: data.designTokens,
    componentPatterns: inferComponentPatterns(data),
    applicationExamples: buildApplicationExamples(data),
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
