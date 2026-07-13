// apps/api/src/utils/mirror/crawl-to-scraped.ts
// Build a ScrapedWebsiteData shape from the crawl homepage HTML so the
// existing doc generators (workspace-memory, site-memory, brand-guidelines,
// business-info, site-strategy, site-hierarchy) can run without extract/segment.

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { MirrorCrawlArtifact } from "../../types/mirror";
import type { ScrapedColor, ScrapedImage } from "@ploy-gyms/shared-types";
import { isAllowedIframeSrc } from "@ploy-gyms/shared-types";
import type { ScrapedSection, ScrapedWebsiteData } from "../scrape-docs";
import type { SectionVisualEvidenceRow } from "../../types/section-visual-evidence";
import { findMostSaturatedColor, hexSaturation, isDarkNeutral } from "../site-blueprint";

interface S3Config {
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  S3_ASSETS_BUCKET: string;
  S3_DEPLOYMENTS_BUCKET?: string;
}

const PHONE_RE = /\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;

function bucketFor(config: S3Config): string {
  return config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
}

async function fetchHtmlFromS3(
  s3: S3Client,
  config: S3Config,
  htmlKey: string,
): Promise<string | undefined> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucketFor(config), Key: htmlKey }));
    return (await res.Body?.transformToString()) ?? undefined;
  } catch {
    return undefined;
  }
}

import { inferSectionType } from "./extract-image-contexts";

function makeVisualEvidence(id: string, pageSlug = "index"): SectionVisualEvidenceRow {
  return {
    evidenceId: id,
    pageSlug,
    sectionId: id,
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    computedStyles: [],
  };
}

const HEX_RE = /#([0-9a-fA-F]{3,8})\b/g;
const RGB_RE = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)/g;

function normalizeHex(raw: string): string | undefined {
  const clean = raw.replace("#", "").toLowerCase();
  if (clean.length === 3 || clean.length === 4) {
    const expanded = clean.split("").map((c) => c + c).join("");
    if (expanded.length === 6) return `#${expanded}`;
    return undefined;
  }
  if (clean.length === 6 || clean.length === 8) {
    return `#${clean.slice(0, 6)}`;
  }
  return undefined;
}

function rgbToHex(rgb: string): string | undefined {
  const m = rgb.match(/rgba?\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})/);
  if (!m) return undefined;
  const r = parseInt(m[1]!, 10);
  const g = parseInt(m[2]!, 10);
  const b = parseInt(m[3]!, 10);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
    return undefined;
  }
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function hexLuminance(hex: string): number {
  const parsed = normalizeHex(hex);
  if (!parsed) return 0.5;
  const full = parsed.replace("#", "");
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function gatherColorsFromHtml($: cheerio.CheerioAPI): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (raw: string) => {
    const hex = raw.startsWith("#") ? normalizeHex(raw) : rgbToHex(raw);
    if (!hex) return;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  };

  // Inline styles.
  $("[style]").each((_, el) => {
    const style = $(el).attr("style") ?? "";
    let m: RegExpExecArray | null;
    while ((m = HEX_RE.exec(style)) !== null) add(m[0]);
    while ((m = RGB_RE.exec(style)) !== null) add(m[0]);
  });

  // <style> blocks.
  $("style").each((_, el) => {
    const css = $(el).text();
    let m: RegExpExecArray | null;
    while ((m = HEX_RE.exec(css)) !== null) add(m[0]);
    while ((m = RGB_RE.exec(css)) !== null) add(m[0]);
  });

  // Link rel=stylesheet hrefs — try to fetch same-origin CSS only.
  $("link[rel='stylesheet']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    // Skip external CSS; colors in the homepage HTML are usually enough and
    // fetching arbitrary third-party URLs is slow/unreliable.
    if (href.startsWith("http") && !href.startsWith("/")) return;
  });

  return counts;
}

function extractColors($: cheerio.CheerioAPI): ScrapedColor[] {
  const counts = gatherColorsFromHtml($);
  if (counts.size === 0) return [];

  const entries = [...counts.entries()].map(([hex, count]) => ({ hex, count }));
  entries.sort((a, b) => b.count - a.count);

  const background = entries.find((c) => hexLuminance(c.hex) > 0.5 && hexSaturation(c.hex) < 0.15)?.hex
    ?? entries.find((c) => hexLuminance(c.hex) > 0.5)?.hex;
  const text = entries.find((c) => hexLuminance(c.hex) < 0.5 && hexSaturation(c.hex) < 0.15 && c.hex !== background)?.hex
    ?? entries.find((c) => isDarkNeutral(c.hex) && c.hex !== background)?.hex
    ?? entries.find((c) => c.hex !== background && hexLuminance(c.hex) < 0.5)?.hex;
  const accent = findMostSaturatedColor(
    entries.filter((c) => c.hex !== background && c.hex !== text && !(c.hex === "#000000" || c.hex === "#ffffff")),
  );

  const colors: ScrapedColor[] = [];
  if (background) {
    colors.push({ token: "bg-primary", hex: background, role: "background" });
  }
  if (text) {
    colors.push({ token: "text-primary", hex: text, role: "text" });
  }
  if (accent) {
    colors.push({ token: "accent-primary", hex: accent, role: "accent" });
  }
  // Muted text from the top neutral that isn't text/background.
  const muted = entries.find((c) => c.hex !== background && c.hex !== text && c.hex !== accent && hexSaturation(c.hex) < 0.15);
  if (muted) {
    colors.push({ token: "text-muted", hex: muted.hex, role: "textMuted" });
  }

  return colors;
}

function extractNavLinks($: cheerio.CheerioAPI): { label: string; href: string }[] {
  const root = $("header nav, header, nav").first();
  const links = root
    .find("a[href]")
    .map((_, el) => {
      const $el = $(el);
      const label = $el.text().trim();
      const href = $el.attr("href") ?? "";
      return { label, href };
    })
    .get();
  return links.filter((l) => l.label.length > 0 && l.href.length > 0 && !l.href.startsWith("#"));
}

function extractBusinessName($: cheerio.CheerioAPI, url: string): string {
  // JSON-LD name
  for (const script of $('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse($(script).text() || "{}") as unknown;
      const candidates: unknown[] = [];
      if (Array.isArray(parsed)) candidates.push(...parsed);
      else candidates.push(parsed);
      for (const c of candidates) {
        if (c && typeof c === "object" && "name" in c && typeof c.name === "string" && c.name.length > 1) {
          return c.name;
        }
      }
    } catch {
      // ignore
    }
  }
  return (
    $('meta[property="og:site_name"]').attr("content")?.trim() ||
    $("title").text().split(/[|–-]/)[0]?.trim() ||
    $("h1").first().text().trim() ||
    url
  );
}

function extractDescription($: cheerio.CheerioAPI): string | undefined {
  return (
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    undefined
  );
}

function extractHeadings($: cheerio.CheerioAPI): { level: number; text: string }[] {
  return $("h1, h2, h3, h4, h5, h6")
    .map((_, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      return { level: Number(tag[1]), text };
    })
    .get()
    .filter((h) => h.text.length > 0);
}

function extractParagraphs($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  $("p").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 30 && text.length < 600) out.push(text);
  });
  return [...new Set(out)];
}

function extractButtons($: cheerio.CheerioAPI): string[] {
  const out: string[] = [];
  $("a[href], button")
    .not("nav a, header a, footer a")
    .each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 0 && text.length <= 60) out.push(text);
    });
  return [...new Set(out)];
}

function extractImages($: cheerio.CheerioAPI): ScrapedImage[] {
  const out: ScrapedImage[] = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    out.push({ url: src, alt: $(el).attr("alt") ?? undefined, context: "other" });
  });
  return out.slice(0, 30);
}

function extractContact($: cheerio.CheerioAPI): {
  phone?: string;
  email?: string;
  address?: string;
  social?: { platform: string; url: string }[];
} {
  const text = $("body").text();
  const phoneMatch = text.match(PHONE_RE);
  const emailMatch = text.match(EMAIL_RE);

  const socials: { platform: string; url: string }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.includes("instagram.com")) socials.push({ platform: "Instagram", url: href });
    else if (href.includes("facebook.com")) socials.push({ platform: "Facebook", url: href });
    else if (href.includes("twitter.com") || href.includes("x.com")) socials.push({ platform: "X", url: href });
    else if (href.includes("youtube.com")) socials.push({ platform: "YouTube", url: href });
  });

  return {
    phone: phoneMatch?.[0],
    email: emailMatch?.[0],
    social: socials.length > 0 ? [...new Map(socials.map((s) => [s.platform, s])).values()] : undefined,
  };
}

function findNearbyHeading($el: cheerio.Cheerio<AnyNode>): string | undefined {
  // Look inside the containing section/article/main/div first.
  const container = $el.closest("section, article, main, div").first();
  const ownHeading = container.find("h1, h2, h3").first().text().trim();
  if (ownHeading.length >= 3 && ownHeading.length <= 200) return ownHeading;

  // Fall back to the nearest preceding heading.
  let prev = $el.prev();
  for (let i = 0; i < 5 && prev.length; i++, prev = prev.prev()) {
    const h = prev.find("h1, h2, h3").first().text().trim() || prev.filter("h1, h2, h3").first().text().trim();
    if (h.length >= 3 && h.length <= 200) return h;
  }
  return undefined;
}

function extractIframeSections($: cheerio.CheerioAPI): ScrapedSection[] {
  const seen = new Set<string>();
  const sections: ScrapedSection[] = [];

  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src")?.trim();
    if (!src || !isAllowedIframeSrc(src)) return;
    if (seen.has(src)) return;
    seen.add(src);

    const $el = $(el);
    const title = $el.attr("title")?.trim();
    const heading = findNearbyHeading($el) || title;
    const type = "iframe";
    const id = `index-iframe-${sections.length}`;

    sections.push({
      id,
      type,
      heading,
      widgetUrl: src,
      visualEvidence: makeVisualEvidence(id),
    });
  });

  return sections;
}

function extractSections($: cheerio.CheerioAPI): ScrapedSection[] {
  const selectors = [
    "body > section",
    "body > article",
    "main > section",
    "main > article",
    "main > div",
    "[class*='section']",
    "[class*='hero']",
    "[class*='block']",
  ];

  const seen = new Set<unknown>();
  const sections: ScrapedSection[] = [];

  $(selectors.join(", ")).each((_, el) => {
    if (seen.has(el)) return;
    seen.add(el);

    const $el = $(el);
    const cls = $el.attr("class") ?? "";

    // Heading: first h1-h3
    let heading: string | undefined;
    $el.find("h1, h2, h3")
      .each((__, h) => {
        const t = $(h).text().trim();
        if (!heading && t.length >= 3 && t.length <= 200) heading = t;
      });

    // Body: first meaningful paragraph
    let body: string | undefined;
    $el.find("p").each((__, p) => {
      const t = $(p).text().trim();
      if (!body && t.length > 30 && t.length < 400) body = t;
    });

    // CTA
    let cta: { label: string; href: string } | undefined;
    $el.find("a[href], button").each((__, a) => {
      const $a = $(a);
      const t = $a.text().trim();
      const href = $a.attr("href") ?? "#";
      if (!cta && t.length > 0 && t.length <= 60 && !href.startsWith("tel:") && !href.startsWith("mailto:")) {
        cta = { label: t, href };
      }
    });

    // Images in section
    const images = $el
      .find("img")
      .map((__, img) => {
        const src = $(img).attr("src");
        return src ? { url: src, alt: $(img).attr("alt") ?? undefined } : null;
      })
      .get()
      .filter(Boolean) as { url: string; alt?: string }[];

    // Items: child cards with headings
    const items: { title?: string; description?: string; imageUrl?: string }[] = [];
    $el.children("div").each((__, child) => {
      const $child = $(child);
      const title = $child.find("h3, h4").first().text().trim();
      const description = $child.find("p").first().text().trim();
      const childImg = $child.find("img").first().attr("src");
      if (title && title.length > 0 && title.length <= 120) {
        items.push({
          title,
          description: description.length > 0 && description.length <= 300 ? description : undefined,
          imageUrl: childImg,
        });
      }
    });

    const type = inferSectionType(cls, heading);
    const id = `index-section-${sections.length}-${type}`;

    sections.push({
      id,
      type,
      heading,
      body,
      cta,
      images: images.length > 0 ? images : undefined,
      items: items.length > 0 ? items : undefined,
      visualEvidence: makeVisualEvidence(id),
    });
  });

  return sections;
}

export async function buildScrapedWebsiteDataFromCrawl(
  crawl: MirrorCrawlArtifact,
  s3: S3Client,
  config: S3Config,
): Promise<ScrapedWebsiteData> {
  const homePage = crawl.pages.find((p) => p.path === "/") ?? crawl.pages[0];
  if (!homePage) {
    return {
      url: crawl.sourceUrl,
      title: crawl.sourceUrl,
      headings: [],
      paragraphs: [],
      buttons: [],
      navLinks: [],
      colors: [],
      fonts: [],
      fontSizes: [],
      images: [],
      layoutRules: [],
      faqs: [],
      testimonials: [],
      locations: [],
      team: [],
      offerings: [],
      contact: {},
    };
  }

  const html = (await fetchHtmlFromS3(s3, config, homePage.htmlKey)) ?? "";
  const $ = cheerio.load(html);

  // Extract colors from raw HTML/styles before stripping script/style tags.
  const colors = extractColors($);

  // Capture iframe widgets before stripping them; otherwise the source site's
  // review/schedule/map embeds are lost and can't be replicated on generated pages.
  const iframeSections = extractIframeSections($);

  // Strip script/style so they don't pollute text extraction.
  $("script, style, noscript, iframe").remove();

  const businessName = extractBusinessName($, crawl.sourceUrl);
  const description = extractDescription($);
  const title = $("title").text().trim() || businessName;

  const contact = extractContact($);

  return {
    url: crawl.sourceUrl,
    title,
    businessName,
    description,
    headings: extractHeadings($).map((h) => h.text),
    paragraphs: extractParagraphs($),
    buttons: extractButtons($),
    navLinks: extractNavLinks($),
    colors,
    fonts: [],
    fontSizes: [],
    images: extractImages($),
    layoutRules: [],
    faqs: [],
    testimonials: [],
    locations: [],
    team: [],
    offerings: [],
    contact,
    sections: [...iframeSections, ...extractSections($)],
  };
}
