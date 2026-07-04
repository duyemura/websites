import type { ScrapedWebsiteData } from "./scrape-docs";
import type {
  ScrapedImage,
  SiteSection,
  TemplateShellPage,
  ThemeTokens,
} from "@ploy-gyms/shared-types";
import type { BrandLogo, HeadingStyle } from "./design-system";
import type { PageBuildStatus } from "../types/site-hierarchy";

const CSS_ARTIFACT_PATTERN = /^\s*[*.#[@:\w-]+\s*\{/;
const MAX_NAV_LABEL_LENGTH = 30;
const MAX_NAV_LINKS = 6;

function isCleanNavLink(link: { label: string; href: string }): boolean {
  const label = link.label.trim();
  if (!label || label.length > MAX_NAV_LABEL_LENGTH) return false;
  if (CSS_ARTIFACT_PATTERN.test(label)) return false;
  if (label.startsWith("<") || label.startsWith("{") || label.startsWith("//")) return false;
  return true;
}

function titleCaseNavLabel(label: string): string {
  return label
    .split(/\s+/)
    .map((word) => {
      if (word.length <= 1) return word.toLowerCase();
      // Preserve existing mixed-case/acronym words (e.g., iOS, KSAC, CrossFit).
      if (!/^[a-z][a-z]*$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function filterNavLinks(links: { label: string; href: string }[]): { label: string; href: string }[] {
  return links
    .filter(isCleanNavLink)
    .map((link) => ({ label: titleCaseNavLabel(link.label.trim()), href: link.href }));
}

const NEUTRAL_TOKENS: ThemeTokens = {
  colors: {
    primary: "#171717",
    primaryForeground: "#ffffff",
    background: "#ffffff",
    foreground: "#171717",
    muted: "#f5f5f5",
    mutedForeground: "#737373",
    border: "#e5e5e5",
  },
  fonts: {
    heading: "Sans-serif",
    body: "Sans-serif",
  },
  radius: "0.5rem",
};

const FALLBACK_PRIMARY = "#171717";

export type { PageBuildStatus };

export interface SiteBlueprint {
  site_metadata: {
    framework: "astro";
    mode: "replication";
    target_url: string;
    business_name?: string;
    generated_at: string;
  };
  design_tokens: ThemeTokens;
  global_shell: {
    theme: ThemeTokens;
    header?: SiteSection;
    footer?: SiteSection;
    navLinks: { label: string; href: string }[];
  };
  brand_identity: {
    logo: BrandLogo;
    heading_style: HeadingStyle;
  };
  reference: {
    /** Generic section types inferred from the source DOM order. */
    section_order?: string[];
  };
  pages: TemplateShellPage[];
  build_plan: {
    /** Slug of the page that should be generated next. */
    next_page: string;
    /** Current status for every page in the blueprint. */
    page_status: Record<string, PageBuildStatus>;
    /** Order in which pages should be built after the homepage is approved. */
    build_order: string[];
  };
}


function hexLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6) return 0.5;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 0.5;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function adjustHex(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (full.length !== 6) return hex;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(parseInt(full.slice(0, 2), 16) + amount);
  const g = clamp(parseInt(full.slice(2, 4), 16) + amount);
  const b = clamp(parseInt(full.slice(4, 6), 16) + amount);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function contrastingForeground(hex: string): string {
  return hexLuminance(hex) < 0.5 ? "#FFFFFF" : "#000000";
}

function fontStack(family: string | undefined): string {
  if (!family) return "Sans-serif, sans-serif";
  // Don't double-append a fallback if the family already declares one.
  if (/sans-serif|serif|monospace|cursive|fantasy|system-ui/i.test(family)) {
    return family;
  }
  return `${family}, sans-serif`;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "our",
  "s",
  "the",
  "to",
  "us",
  "we",
  "with",
  "you",
  "your",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function imageFileName(image: ScrapedImage): string {
  try {
    return new URL(image.url).pathname.split("/").pop() ?? "";
  } catch {
    return "";
  }
}

function isLogoLike(image: ScrapedImage): boolean {
  if (image.context === "logo" || image.context === "hero") return true;
  const fileName = imageFileName(image);
  const text = [fileName, image.alt ?? "", image.context, ...(image.promptKeywords ?? [])].join(" ");
  return /\blogo\b|logosecondary|logomark|brandmark/i.test(text);
}

function scoreLogoImage(image: ScrapedImage): number {
  const fileName = imageFileName(image).toLowerCase();
  let score = 0;
  if (image.context === "logo") score += 100;
  if (fileName.includes("primary")) score += 50;
  if (fileName.includes("logo")) score += 20;
  if (fileName.includes("secondary")) score -= 80;
  if (fileName.includes("logosecondary")) score -= 120;
  if (image.alt?.toLowerCase().includes("logo")) score += 15;
  return score;
}

export function extractLogo(data: ScrapedWebsiteData): BrandLogo {
  const logoCandidates = data.images
    .filter((img) => img.context === "logo" || imageFileName(img).toLowerCase().includes("logo"))
    .sort((a, b) => scoreLogoImage(b) - scoreLogoImage(a));

  const best = logoCandidates[0];
  if (best?.url && scoreLogoImage(best) > 0) {
    return { type: "image", value: best.url, alt: best.alt ?? data.businessName };
  }
  return { type: "text", value: data.businessName ?? data.title };
}

function scoreImageForCard(
  card: { title?: string; description?: string },
  image: ScrapedImage,
): number {
  if (isLogoLike(image)) return -1000;
  const cardTokens = new Set([
    ...tokenize(card.title ?? ""),
    ...tokenize(card.description ?? ""),
  ]);
  const imageText = [
    image.alt ?? "",
    image.context,
    ...(image.promptKeywords ?? []),
  ].join(" ");
  let score = 0;
  for (const token of tokenize(imageText)) {
    if (cardTokens.has(token)) score += 1;
  }
  // Generic gym imagery is still useful for cards even without a keyword match.
  if (image.context === "other" || image.context === "team" || image.context === "background") {
    score += 0.5;
  }
  return score;
}

function isSvgIcon(url: string | undefined): boolean {
  if (!url) return false;
  return /\.svg(?:\?|$)/i.test(url);
}

function findImageForCard(
  card: { title?: string; description?: string; imageUrl?: string },
  images: ScrapedImage[],
  used: Set<string>,
  preferSvg = false,
): string | undefined {
  const pool = images.filter((i) => !isLogoLike(i) && (preferSvg ? isSvgIcon(i.url) : true));
  const unused = pool.filter((i) => !used.has(i.url));
  const candidates = unused.length > 0 ? unused : pool;
  const ranked = candidates
    .map((image) => ({ image, score: scoreImageForCard(card, image) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  // Use the best available image as long as it is not logo-like. Reusing the
  // same generic gym photo across every card hurts fidelity, so we track used
  // images per-section and globally and only assign an image when one is
  // available. Dropping the strict score threshold lets cards get imagery even
  // when vision tags are generic, while the usage tracking prevents repetition.
  if (!best) return undefined;
  used.add(best.image.url);
  return best.image.url;
}

function attachImagesToSections(sections: SiteSection[], images: ScrapedImage[]): void {
  const globalUsed = new Set<string>();

  for (const section of sections) {
    const imageStyle = section.props.imageStyle as "top" | "icon" | "background" | undefined;
    const preferSvg = imageStyle === "icon";

    if (section.type === "SiteCardGroup" && Array.isArray(section.props.cards)) {
      // Icon-style cards should only use SVG icons; never stretch a photo into a
      // tiny container. Photo-style cards should avoid SVGs that look broken at
      // full card width.
      const sectionUsed = new Set<string>();
      for (const card of section.props.cards) {
        // Preserve an explicitly scraped SVG icon, but drop a scraped photo that
        // is about to be forced into an icon slot.
        if (preferSvg && card.imageUrl && !isSvgIcon(card.imageUrl)) {
          card.imageUrl = undefined;
        }
        // If the card already has a suitable image from the DOM, keep it and
        // just track usage. Only backfill missing cards from the global pool.
        if (card.imageUrl) {
          sectionUsed.add(card.imageUrl);
          globalUsed.add(card.imageUrl);
          continue;
        }
        const imageUrl =
          findImageForCard(card, images, sectionUsed, preferSvg) ??
          findImageForCard(card, images, globalUsed, preferSvg);
        if (imageUrl) {
          card.imageUrl = imageUrl;
          sectionUsed.add(imageUrl);
          globalUsed.add(imageUrl);
        }
      }
    }

    if (section.type === "SiteSteps" && Array.isArray(section.props.steps)) {
      // Steps use small icon thumbnails; avoid assigning full photos. Keep only
      // icons that were explicitly scraped with a step; never backfill generic
      // icons from the global pool so numbered steps match the source layout.
      for (const step of section.props.steps) {
        if (step.imageUrl && !isSvgIcon(step.imageUrl)) {
          step.imageUrl = undefined;
        }
      }
    }

    if (section.type === "Text" && section.props.imageUrl) {
      const imageUrl = findImageForCard({ imageUrl: section.props.imageUrl as string }, images, globalUsed);
      if (imageUrl) {
        section.props.imageUrl = imageUrl;
        globalUsed.add(imageUrl);
      }
    }
  }
}

function buildDesignTokens(data: ScrapedWebsiteData): ThemeTokens {
  const text = data.colors.find((c) => c.role === "text")?.hex;
  const bg = data.colors.find((c) => c.role === "background")?.hex;
  const accentCandidate = data.colors.find((c) => c.role === "accent")?.hex;
  // No longer filtering by isLinkBlue — the computedTheme extraction now uses
  // saturation to find the brand accent, so high-saturation blues ARE brand colors.
  const accent = accentCandidate;
  const surface = data.colors.find((c) => c.role === "surface")?.hex;
  const textMuted = data.colors.find((c) => c.role === "textMuted")?.hex;
  const border = data.colors.find((c) => c.role === "border")?.hex;
  const headingFont = data.fonts.find((f) => f.role === "heading")?.family;
  const bodyFont = data.fonts.find((f) => f.role === "body")?.family;
  const radius =
    data.designTokens?.find((t) => t.category === "radius")?.value ??
    NEUTRAL_TOKENS.radius;

  // Use the website's own accent or text color as the primary CTA color. If it
  // would disappear against the page background, fall back to a neutral.
  let primary = accent ?? text;
  if (!primary || primary.toUpperCase() === bg?.toUpperCase()) {
    primary = FALLBACK_PRIMARY;
  }

  // Derive a muted surface from the background when none was scraped.
  let muted = surface;
  if (!muted && bg) {
    muted = adjustHex(bg, 18);
  }

  // Muted foreground must be readable against the muted surface.
  let mutedForeground = textMuted;
  if (!mutedForeground && muted) {
    mutedForeground = contrastingForeground(muted) === "#FFFFFF" ? "#A3A3A3" : "#525252";
  }

  return {
    colors: {
      primary,
      primaryForeground: contrastingForeground(primary),
      background: bg ?? NEUTRAL_TOKENS.colors.background,
      foreground: text ?? NEUTRAL_TOKENS.colors.foreground,
      muted: muted ?? NEUTRAL_TOKENS.colors.muted,
      mutedForeground: mutedForeground ?? NEUTRAL_TOKENS.colors.mutedForeground,
      border: border ?? (bg ? adjustHex(bg, 30) : NEUTRAL_TOKENS.colors.border),
    },
    fonts: {
      heading: fontStack(headingFont),
      // If the body font is just a generic fallback, reuse the heading face so
      // the page feels cohesive and headings don't end up as the only custom font.
      body: fontStack(bodyFont && !/^sans-serif$/i.test(bodyFont) ? bodyFont : headingFont),
    },
    radius,
  };
}

export function deriveSlug(href: string, fallback: string): string {
  try {
    if (href.startsWith("/")) {
      const rawSlug = href.replace(/^\/+/, "").split("/")[0];
      const slug = rawSlug?.split(/[?#]/)[0];
      if (slug) return slug;
    }
    const url = new URL(href);
    const slug = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (slug) return slug;
  } catch {
    // fall through to fallback
  }
  return (
    fallback.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
    "page"
  );
}

function makeTextSection(
  title: string,
  body: string,
  sectionId: string,
  sourceOrder?: number,
): SiteSection {
  return {
    id: sectionId,
    type: "Text",
    props: { title, body, align: "center", sourceOrder },
  };
}

function detectCardImageStyle(
  cards: { description?: string; imageUrl?: string }[],
): "top" | "icon" | "background" | undefined {
  if (cards.length === 0) return undefined;
  if (cards.every((c) => c.imageUrl && isSvgIcon(c.imageUrl))) return "icon";
  if (cards.every((c) => !c.description && c.imageUrl)) {
    // Image-first cards without body text are rendered as background tiles.
    return "background";
  }
  return "top";
}

function makeCardGroupSection(
  title: string,
  items: { title?: string; description?: string; imageUrl?: string }[],
  sectionId: string,
  variant?: "dark",
  sourceOrder?: number,
  imageStyle?: "top" | "icon",
): SiteSection {
  const cards = items.map((item) => ({
    title: item.title,
    description: item.description,
    imageUrl: item.imageUrl,
  }));
  return {
    id: sectionId,
    type: "SiteCardGroup",
    props: {
      title,
      layout: items.length >= 3 ? "grid" : "row",
      variant,
      sourceOrder,
      imageStyle: imageStyle ?? detectCardImageStyle(cards),
      cards,
    },
  };
}

function makeFeatureSection(
  headings: string[],
  paragraphs: string[],
  sectionId: string,
): SiteSection | null {
  const heroHeading = headings[0];
  const featureHeadings = headings
    .slice(1)
    .filter((h) => h.split(/\s+/).length <= 4 && h !== heroHeading && h.length > 0)
    .slice(0, 3);
  if (featureHeadings.length === 0) return null;

  const cards = featureHeadings.map((heading, idx) => ({
    title: heading,
    description: paragraphs[idx] ?? "",
  }));

  return makeCardGroupSection("", cards, sectionId, undefined, 1);
}

function makeStepsSection(
  headings: string[],
  paragraphs: string[],
  sectionId: string,
): SiteSection | null {
  const startIdx = headings.findIndex((h) => /getting started|how it works|steps|start today/i.test(h));
  if (startIdx === -1) return null;

  const title = headings[startIdx];
  const stepHeadings = headings
    .slice(startIdx + 1)
    .filter((h) => h.split(/\s+/).length <= 6)
    .slice(0, 3);
  if (stepHeadings.length === 0) return null;

  return {
    id: sectionId,
    type: "SiteSteps",
    props: {
      title: title ?? "",
      variant: "dark",
      sourceOrder: startIdx,
      steps: stepHeadings.map((heading, idx) => ({
        title: heading,
        description: paragraphs[startIdx + idx] ?? "",
      })),
    },
  };
}

function makeAmenitiesSection(
  headings: string[],
  sectionId: string,
): SiteSection | null {
  const startIdx = headings.findIndex((h) =>
    /everything you need|amenities|facilities|what you get|what's included/i.test(h),
  );
  if (startIdx === -1) return null;

  const title = headings[startIdx];
  const itemHeadings = headings
    .slice(startIdx + 1)
    .filter((h) => h.split(/\s+/).length <= 6 && /^[A-Z]/.test(h))
    .slice(0, 6);
  if (itemHeadings.length < 3) return null;

  const cards = itemHeadings.map((heading) => ({ title: heading, description: "" }));
  return makeCardGroupSection(title ?? "", cards, sectionId, undefined, startIdx, "icon");
}

function makeCommunitySection(
  headings: string[],
  paragraphs: string[],
  sectionId: string,
): SiteSection | null {
  const idx = headings.findIndex((h) => /community/i.test(h));
  if (idx === -1) return null;

  const title = headings[idx];
  const body = paragraphs.slice(0, 4).join("\n\n");
  if (!body) return null;

  return {
    id: sectionId,
    type: "Text",
    props: { title, body, align: "center", variant: "dark", sourceOrder: idx },
  };
}

function makeFinalCTASection(
  title: string,
  subtitle: string,
  buttonLabel: string,
  sectionId: string,
): SiteSection | null {
  if (!title || !buttonLabel) return null;
  return {
    id: sectionId,
    type: "SiteCTA",
    props: { title, subtitle, cta: { label: buttonLabel, href: "#cta" } },
  };
}

function makeReviewsSection(
  testimonials: { quote: string; author?: string; role?: string }[],
  sectionId: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteReviews",
    props: {
      title: "What members say",
      reviews: testimonials.map((t) => ({
        quote: t.quote,
        author: [t.author, t.role].filter(Boolean).join(", "),
      })),
    },
  };
}

function makeHeroSection(
  data: ScrapedWebsiteData,
  sectionId: string,
): SiteSection {
  const headingStyle = detectHeadingStyle(data);
  const heroImage = data.images.find((i) => i.context === "hero");
  const overlayOpacity = heroImage ? 0.4 : 0;
  return {
    id: sectionId,
    type: "Hero",
    props: {
      title: data.headings[0] ?? "",
      subtitle: data.paragraphs[0] ?? "",
      cta: { label: data.buttons[0] ?? "", href: "#cta" },
      backgroundImage: heroImage?.url ?? null,
      styleHint: {
        uppercase: headingStyle.uppercase,
        bold: headingStyle.bold,
        overlayOpacity,
      },
    },
  };
}

function makeHeaderSection(data: ScrapedWebsiteData): SiteSection {
  const hasHeroImage = data.images.some((i) => i.context === "hero");
  return {
    id: "header",
    type: "SiteHeader",
    props: {
      logo: extractLogo(data),
      navLinks: data.navLinks,
      variant: hasHeroImage ? "transparent" : "default",
      headerCtaStyle: data.headerCtaStyle,
      ctaLabel: data.buttons[0] ?? undefined,
      ctaHref: "#cta",
    },
  };
}

function makeFooterSection(data: ScrapedWebsiteData): SiteSection {
  const businessName = data.businessName ?? data.title;
  const year = new Date().getFullYear();
  return {
    id: "footer",
    type: "SiteFooter",
    props: {
      businessName,
      navLinks: data.navLinks,
      socialLinks: data.contact?.social ?? [],
      copyright: `© ${year} ${businessName}. All rights reserved.`,
    },
  };
}

function cleanFaqBody(body: string | undefined): string {
  if (!body) return "";
  return body
    .replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "")
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "")
    .replace(/\bContact\s+Us\b/gi, "")
    .replace(/\bTalk\s+to\s+us\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[!?.,:;]\s*$/, "")
    .trim();
}

function pickHeroBackground(images: { url: string; context?: string }[] | undefined): string | null {
  if (!images || images.length === 0) return null;
  const isPhoto = (url: string) => !isSvgIcon(url);
  return (
    images.find((i) => i.context === "hero" && isPhoto(i.url))?.url ??
    images.find((i) => i.context === "section" && isPhoto(i.url))?.url ??
    images.find((i) => i.context === "background" && isPhoto(i.url))?.url ??
    images.find((i) => isPhoto(i.url))?.url ??
    images[0]?.url ??
    null
  );
}

function mapScrapedSectionToSiteSection(
  section: import("./scrape-docs").ScrapedSection,
  defaultCta?: { label: string; href: string } | null,
): SiteSection | null {
  const props: Record<string, unknown> = {
    title: section.heading ?? "",
    body: section.body ?? "",
    sourceOrder: section.styleHint?.sourceOrder,
  };

  switch (section.type) {
    case "Hero": {
      const heroBg = pickHeroBackground(section.images);
      const cta = section.items?.[0]
        ? { label: section.items[0].title ?? "", href: section.items[0].description ?? "#" }
        : defaultCta ?? null;
      return {
        id: section.id,
        type: "Hero",
        props: {
          title: section.heading ?? "",
          subtitle: section.body ?? "",
          cta,
          backgroundImage: heroBg,
          styleHint: {
            uppercase: section.styleHint?.uppercase ?? true,
            bold: true,
            overlayOpacity: 0.5,
            align: section.styleHint?.align,
            eyebrow: section.styleHint?.eyebrow,
            ctaStyle: section.styleHint?.ctaStyle,
            heroTextColor: section.styleHint?.heroTextColor,
            heroCtaBg: section.styleHint?.heroCtaBg,
            heroCtaColor: section.styleHint?.heroCtaColor,
            heroCtaRadius: section.styleHint?.heroCtaRadius,
            heroCtaHasIcon: section.styleHint?.heroCtaHasIcon,
            heroCtaUppercase: section.styleHint?.heroCtaUppercase,
            heroCtaBold: section.styleHint?.heroCtaBold,
            heroCtaTransform: section.styleHint?.heroCtaTransform,
            heroCtaPadding: section.styleHint?.heroCtaPadding,
            subtitleUppercase: section.styleHint?.subtitleUppercase,
            eyebrowBg: section.styleHint?.eyebrowBg,
            eyebrowColor: section.styleHint?.eyebrowColor,
            eyebrowPadding: section.styleHint?.eyebrowPadding,
          },
        },
      };
    }
    case "SiteCardGroup": {
      const items = section.items ?? [];
      const imageStyle =
        section.styleHint?.imagePosition === "background" ? "background" : detectCardImageStyle(items);
      const hasSectionBackground =
        imageStyle !== "background" &&
        (section.styleHint?.imagePosition === "background" ||
          section.images?.some((i) => i.context === "background"));
      return {
        id: section.id,
        type: "SiteCardGroup",
        props: {
          title: section.heading ?? "",
          subtitle: section.body ?? "",
          layout: items.length >= 3 ? "grid" : "row",
          imageStyle,
          backgroundImage: hasSectionBackground ? section.images?.[0]?.url : undefined,
          sourceOrder: section.styleHint?.sourceOrder,
          cards: items.map((item) => ({
            title: item.title,
            description: item.description,
            imageUrl: item.imageUrl,
          })),
        },
      };
    }
    case "SiteSteps":
      return {
        id: section.id,
        type: "SiteSteps",
        props: {
          title: section.heading ?? "",
          sourceOrder: section.styleHint?.sourceOrder,
          steps: section.items?.map((item) => ({
            title: item.title,
            description: item.description,
            imageUrl: item.imageUrl,
          })) ?? [],
        },
      };
    case "SiteImageGallery":
      return {
        id: section.id,
        type: "SiteBlock",
        props: {
          ...props,
          layout: "gallery",
          images: section.images?.map((i) => i.url) ?? [],
        },
      };
    case "SiteReviews":
      return {
        id: section.id,
        type: "SiteReviews",
        props: {
          title: section.heading ?? "What members say",
          reviews: section.items?.map((item) => ({ quote: item.title ?? item.description ?? "" })) ?? [],
          widgetUrl: section.widgetUrl,
        },
      };
    case "SiteFAQ": {
      const faqBody = cleanFaqBody(section.body);
      return {
        id: section.id,
        type: "SiteBlock",
        props: {
          ...props,
          body: faqBody,
          layout: "faq",
          items: section.items ?? [],
        },
      };
    }
    case "SiteCTA": {
      const hasBackgroundImage =
        section.styleHint?.imagePosition === "background" ||
        section.images?.some((i) => i.context === "background") ||
        false;
      return {
        id: section.id,
        type: "SiteCTA",
        props: {
          title: section.heading ?? "",
          subtitle: section.body ?? "",
          cta: section.items?.[0]
            ? { label: section.items[0].title ?? "", href: section.items[0].description ?? "#" }
            : null,
          backgroundImage: hasBackgroundImage ? section.images?.[0]?.url : undefined,
        },
      };
    }
    case "SiteLocation": {
      const heading = section.heading ?? "";
      const isHeadingProse = heading.length > 80 || !heading.includes(",");
      const title = isHeadingProse ? "Visit us" : heading;
      const address = isHeadingProse ? [heading, section.address ?? section.body ?? ""].filter(Boolean).join("\n") : (section.address ?? section.body ?? "");
      return {
        id: section.id,
        type: "SiteLocation",
        props: {
          title,
          address,
          hours: "",
          phone: "",
          mapLink: "#map",
        },
      };
    }
    case "Text":
    default: {
      const imageUrl = section.images?.[0]?.url;
      const imagePosition =
        section.styleHint?.imagePosition === "left" || section.styleHint?.imagePosition === "right"
          ? section.styleHint.imagePosition
          : imageUrl
            ? "left"
            : "none";
      return {
        id: section.id,
        type: "Text",
        props: {
          title: section.heading ?? "",
          body: section.body ?? "",
          align: imagePosition !== "none" ? "left" : section.styleHint?.centered !== false ? "center" : "left",
          imageUrl,
          imagePosition,
          sourceOrder: section.styleHint?.sourceOrder,
        },
      };
    }
  }
}

function buildHomePageFromSections(data: ScrapedWebsiteData): TemplateShellPage | null {
  if (!data.sections || data.sections.length === 0) return null;

  const defaultCta = data.buttons[0] ? { label: data.buttons[0], href: "#cta" } : null;
  const sections: SiteSection[] = [];
  for (const scraped of data.sections) {
    const mapped = mapScrapedSectionToSiteSection(scraped, defaultCta);
    if (!mapped) continue;
    // Drop empty text placeholders created by generic extraction gaps.
    if (
      mapped.type === "Text" &&
      !mapped.props.title &&
      !mapped.props.body &&
      !mapped.props.imageUrl
    )
      continue;
    sections.push(mapped);
  }

  // Fallback to hardcoded builder if generic extraction produced no usable sections.
  if (sections.length === 0) return null;

  attachImagesToSections(sections, data.images);

  return {
    slug: "index",
    isHomePage: true,
    title: data.title,
    metaTitle: data.title,
    metaDescription: data.description ?? "",
    primaryCta: primaryCtaFromPage(sections),
    sections,
  };
}

function buildHomePage(data: ScrapedWebsiteData): TemplateShellPage {
  const fromGeneric = buildHomePageFromSections(data);
  if (fromGeneric) return fromGeneric;

  const sections: SiteSection[] = [];
  const sectionId = (prefix: string) => `home-${prefix}`;

  if (data.headings.length > 0 || data.paragraphs.length > 0) {
    sections.push(makeHeroSection(data, sectionId("hero")));
  }

  const aboutBody = data.description || "";
  if (aboutBody.length > 20) {
    sections.push(makeTextSection("About us", aboutBody, sectionId("about")));
  }

  const featureSection = makeFeatureSection(
    data.headings,
    data.paragraphs,
    sectionId("features"),
  );
  if (featureSection) {
    sections.push(featureSection);
  }

  if (data.offerings.length > 0) {
    sections.push(
      makeCardGroupSection(
        "What we offer",
        data.offerings.map((o) => ({
          title: o.name,
          description: o.description,
        })),
        sectionId("offerings"),
        "dark",
      ),
    );
  }

  const stepsSection = makeStepsSection(
    data.headings,
    data.paragraphs,
    sectionId("steps"),
  );
  if (stepsSection) {
    sections.push(stepsSection);
  }

  const amenitiesSection = makeAmenitiesSection(
    data.headings,
    sectionId("amenities"),
  );
  if (amenitiesSection) {
    sections.push(amenitiesSection);
  }

  const communitySection = makeCommunitySection(
    data.headings,
    data.paragraphs,
    sectionId("community"),
  );
  if (communitySection) {
    sections.push(communitySection);
  }

  if (data.testimonials.length > 0) {
    sections.push(makeReviewsSection(data.testimonials, sectionId("reviews")));
  }

  const finalCTA = makeFinalCTASection(
    data.headings[0] ?? "",
    data.paragraphs[0] ?? "",
    data.buttons[0] ?? "",
    sectionId("cta"),
  );
  if (finalCTA) {
    sections.push(finalCTA);
  }

  if (data.locations.length > 0) {
    sections.push(
      makeLocationSection(
        data.locations,
        sectionId("location"),
        data.contact?.phone,
      ),
    );
  }

  attachImagesToSections(sections, data.images);

  return {
    slug: "index",
    isHomePage: true,
    title: data.title,
    metaTitle: data.title,
    metaDescription: data.description ?? "",
    primaryCta: primaryCtaFromPage(sections),
    sections,
  };
}

function primaryCtaFromPage(sections: SiteSection[]): { label: string; href: string } | undefined {
  // Prefer the first Hero CTA, then any CTA-like section, then the first button-bearing card group.
  const hero = sections.find((s) => s.type === "Hero");
  if (hero?.props.cta) {
    const cta = hero.props.cta as { label?: string; href?: string } | undefined;
    if (cta?.label) return { label: cta.label, href: cta.href || "#cta" };
  }

  const ctaSection = sections.find((s) => s.type === "SiteCTA");
  if (ctaSection?.props.cta) {
    const cta = ctaSection.props.cta as { label?: string; href?: string } | undefined;
    if (cta?.label) return { label: cta.label, href: cta.href || "#cta" };
  }

  return undefined;
}

function makeLocationSection(
  locations: { name?: string; address?: string; hours?: string }[],
  sectionId: string,
  phone?: string,
): SiteSection {
  return {
    id: sectionId,
    type: "SiteLocation",
    props: {
      title: "Visit us",
      address: locations
        .map((loc) => [loc.name, loc.address].filter(Boolean).join(" — "))
        .join("\n"),
      hours: locations[0]?.hours ?? "",
      phone: phone ?? "",
      mapLink: "#map",
    },
  };
}

function inferSecondaryPage(
  link: { label: string; href: string },
  data: ScrapedWebsiteData,
): TemplateShellPage | null {
  const slug = deriveSlug(link.href, link.label);
  const title = link.label;
  const label = link.label.toLowerCase();
  const sections: SiteSection[] = [];
  const sectionId = (prefix: string) => `${slug}-${prefix}`;

  if (
    label.includes("class") ||
    label.includes("service") ||
    label.includes("program") ||
    label.includes("membership") ||
    label.includes("pricing")
  ) {
    if (data.offerings.length > 0) {
      sections.push(
        makeCardGroupSection(
          title,
          data.offerings.map((o) => ({
            title: o.name,
            description: o.description,
          })),
          sectionId("offerings"),
        ),
      );
    }
  } else if (
    label.includes("coach") ||
    label.includes("team") ||
    label.includes("trainer") ||
    label.includes("staff")
  ) {
    if (data.team.length > 0) {
      sections.push(
        makeCardGroupSection(
          title,
          data.team.map((member) => ({
            title: member.name,
            description: member.bio,
          })),
          sectionId("team"),
        ),
      );
    }
  } else if (
    label.includes("about") ||
    label.includes("story") ||
    label.includes("mission")
  ) {
    const body =
      data.description ||
      data.paragraphs.slice(0, 2).join("\n\n") ||
      "";
    if (body) {
      sections.push(makeTextSection(title, body, sectionId("about")));
    }
  } else if (
    label.includes("contact") ||
    label.includes("location") ||
    label.includes("visit") ||
    label.includes("find us")
  ) {
    if (data.locations.length > 0) {
      sections.push(
        makeLocationSection(
          data.locations,
          sectionId("location"),
          data.contact?.phone,
        ),
      );
    }
  } else if (
    label.includes("testimonial") ||
    label.includes("review") ||
    label.includes("result")
  ) {
    if (data.testimonials.length > 0) {
      sections.push(makeReviewsSection(data.testimonials, sectionId("reviews")));
    }
  }

  if (sections.length === 0) {
    const body = data.description ?? data.paragraphs[0] ?? "";
    if (body) {
      sections.push(makeTextSection(title, body, sectionId("content")));
    }
  }

  if (sections.length === 0) {
    return null;
  }

  const primaryCta = data.buttons[0] ? { label: data.buttons[0], href: "#cta" } : undefined;

  return {
    slug,
    title,
    isHomePage: false,
    metaTitle: title,
    primaryCta,
    sections,
  };
}

function isInternalRelativeLink(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

export function detectHeadingStyle(data: ScrapedWebsiteData): HeadingStyle {
  const headingFont = data.fonts.find((f) => f.role === "heading");
  const weights = headingFont?.weights ?? [];
  const textUppercaseFromScale = data.fontSizes.some(
    (s) =>
      (s.element === "Hero heading" || s.element === "Section heading") &&
      s.notes?.toLowerCase().includes("uppercase"),
  );
  const textUppercaseFromHeadings = data.headings.length > 0 && data.headings.slice(0, 6).filter((h) => h === h.toUpperCase()).length >= 2;
  const bold = weights.some((w) => w >= 700) || textUppercaseFromHeadings || textUppercaseFromScale;
  const condensed = /condensed|narrow|compressed/i.test(headingFont?.family ?? "");
  const uppercase = textUppercaseFromHeadings || textUppercaseFromScale;
  return { uppercase, bold, condensed };
}

export function buildSiteBlueprint(data: ScrapedWebsiteData): SiteBlueprint {
  const filteredNavLinks = filterNavLinks(data.navLinks);
  const navLinks = filteredNavLinks.slice(0, MAX_NAV_LINKS);
  const header = makeHeaderSection({ ...data, navLinks });
  const footer = makeFooterSection({ ...data, navLinks });
  const logo = extractLogo(data);
  const tokens = buildDesignTokens(data);
  const headingStyle = detectHeadingStyle(data);

  const homePage = buildHomePage(data);
  const sectionOrder = homePage.sections.map((s) => s.type);

  const secondaryPages = filteredNavLinks
    .filter((link) => isInternalRelativeLink(link.href) && link.href !== "/")
    .map((link) => inferSecondaryPage(link, { ...data, navLinks: filteredNavLinks }))
    .filter((page): page is TemplateShellPage => page !== null);

  const pages = [homePage, ...secondaryPages];
  const pageStatus: Record<string, PageBuildStatus> = {};
  for (const page of pages) {
    pageStatus[page.slug] = page.isHomePage ? "in_progress" : "planned";
  }

  return {
    site_metadata: {
      framework: "astro",
      mode: "replication",
      target_url: data.url,
      business_name: data.businessName,
      generated_at: new Date().toISOString(),
    },
    design_tokens: tokens,
    global_shell: {
      theme: tokens,
      header: {
        ...header,
        props: {
          ...header.props,
          logo,
        },
      },
      footer,
      navLinks,
    },
    brand_identity: {
      logo,
      heading_style: headingStyle,
    },
    reference: {
      section_order: sectionOrder,
    },
    pages,
    build_plan: {
      next_page: "index",
      page_status: pageStatus,
      build_order: pages.map((p) => p.slug),
    },
  };
}

export const extractHeaderSection = makeHeaderSection;
export const extractFooterSection = makeFooterSection;
export const deriveThemeTokens = buildDesignTokens;
