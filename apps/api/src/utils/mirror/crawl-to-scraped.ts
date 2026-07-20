// apps/api/src/utils/mirror/crawl-to-scraped.ts
// Build a ScrapedWebsiteData shape from the crawl homepage HTML so the
// existing doc generators (workspace-memory, site-memory, brand-guidelines,
// business-info, site-strategy, site-hierarchy) can run without extract/segment.

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { MirrorCrawlArtifact } from "../../types/mirror";
import type { ScrapedColor, ScrapedImage } from "@milo/shared-types";
import { isAllowedIframeSrc, inferIframeVariant, sanitizeIframe } from "@milo/shared-types";
import type { IframeEmbed } from "@milo/shared-types";
import type { ScrapedSection, ScrapedWebsiteData } from "../scrape-docs";
import type { SectionVisualEvidenceRow } from "../../types/section-visual-evidence";
import { findMostSaturatedColor, hexSaturation, isDarkNeutral } from "../site-blueprint";

const ALLOWED_URL_SCHEMES = new Set(["http:", "https:"]);

function isSafeUrl(href: string): boolean {
  // Allow root-relative paths that start with '/' (same-origin, no scheme).
  if (href.startsWith("/")) return true;
  try {
    const url = new URL(href);
    return ALLOWED_URL_SCHEMES.has(url.protocol);
  } catch {
    return false;
  }
}

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

async function fetchHtmlFromS3ByBucket(
  s3: S3Client,
  bucket: string,
  htmlKey: string,
): Promise<string | undefined> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: htmlKey }));
    return (await res.Body?.transformToString()) ?? undefined;
  } catch {
    return undefined;
  }
}

async function fetchHtmlFromS3(
  s3: S3Client,
  config: S3Config,
  htmlKey: string,
): Promise<string | undefined> {
  return fetchHtmlFromS3ByBucket(s3, bucketFor(config), htmlKey);
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

type NavItem = { label: string; href: string; children?: NavItem[] };

/**
 * Extract flat nav links and build a hierarchy from path structure.
 *
 * Works for any site type — the parent label ("Programs", "Our Beans",
 * "Services") comes from the source HTML, never hardcoded. Dropdowns are
 * inferred by grouping same-prefix paths: /programs/bootcamp and
 * /programs/personal-training both nest under /programs.
 *
 * Returns flat links too (navLinks field) for backward compat.
 */
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
  return links.filter((l) => l.label.length > 0 && l.href.length > 0 && !l.href.startsWith("#") && isSafeUrl(l.href));
}

/**
 * Build a nav hierarchy from flat links using path-prefix grouping.
 *
 * Normalizes absolute URLs to root-relative paths using the site's source URL
 * (so GitHub Pages absolute hrefs like https://beanburito.github.io/pushpress-site-modern/programs
 * become /programs, not "https:" as a parent segment).
 *
 * Items at /a/b automatically nest under /a — the parent label comes from
 * the /a link if present in the source HTML, otherwise title-cased from the slug.
 * Nothing about what the business sells is assumed or hardcoded.
 */
export function buildNavHierarchy(
  flatLinks: { label: string; href: string }[],
  sourceUrl?: string,
): NavItem[] {
  const UTILITY = /login|sign in|sign up|my account|account|search|cart/i;

  // Determine origin + base path to strip from absolute URLs.
  // e.g. sourceUrl = "https://beanburito.github.io/pushpress-site-modern/"
  //   → origin = "https://beanburito.github.io"
  //   → basePath = "/pushpress-site-modern"
  let origin = "";
  let basePath = "";
  if (sourceUrl) {
    try {
      const u = new URL(sourceUrl);
      origin = u.origin;
      // Strip trailing slash; keep base sub-path (e.g. /pushpress-site-modern)
      basePath = u.pathname.replace(/\/$/, "").split("/").slice(0, -1).join("") ||
        u.pathname.replace(/\/$/, "");
    } catch { /* ignore */ }
  }

  // Normalize an href to a root-relative path (e.g. "/programs/bootcamp")
  function toPath(href: string): string {
    // Absolute URL on same origin
    if (href.startsWith("http://") || href.startsWith("https://")) {
      try {
        const u = new URL(href);
        if (origin && u.origin !== origin) return ""; // external — skip
        let path = u.pathname;
        if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length);
        return path.replace(/\/$/, "") || "/";
      } catch { return ""; }
    }
    // Root-relative path: strip basePath prefix if present
    if (href.startsWith("/") && basePath && href.startsWith(basePath)) {
      return href.slice(basePath.length).replace(/\/$/, "") || "/";
    }
    return href.startsWith("/") ? href.replace(/\/$/, "") : `/${href}`;
  }

  const items: NavItem[] = [];
  const byHref = new Map<string, NavItem>();

  for (const link of flatLinks) {
    if (!link.label || UTILITY.test(link.label)) continue;
    const href = toPath(link.href);
    if (!href || href === "/") continue;

    const parts = href.split("/").filter(Boolean);

    if (parts.length <= 1) {
      if (!byHref.has(href)) {
        const item: NavItem = { label: link.label, href };
        items.push(item);
        byHref.set(href, item);
      }
    } else {
      const parentHref = `/${parts[0]}`;
      let parent = byHref.get(parentHref);

      if (!parent) {
        const impliedLabel = parts[0].split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        parent = { label: impliedLabel, href: parentHref, children: [] };
        items.push(parent);
        byHref.set(parentHref, parent);
      }

      parent.children = parent.children ?? [];
      if (!parent.children.some(c => c.href === href)) {
        parent.children.push({ label: link.label, href });
      }
    }
  }

  return items;
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
    if (!src || !isSafeUrl(src)) return;
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

function extractPageIframeSections($: cheerio.CheerioAPI): IframeEmbed[] {
  const seen = new Set<string>();
  const out: IframeEmbed[] = [];

  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src")?.trim();
    if (!src || !isAllowedIframeSrc(src)) return;
    if (seen.has(src)) return;
    seen.add(src);

    const $el = $(el);
    const title = $el.attr("title")?.trim() || findNearbyHeading($el);
    const width = $el.attr("width")?.trim();
    const height = $el.attr("height")?.trim();
    const sandbox = $el.attr("sandbox")?.trim();
    const allow = $el.attr("allow")?.trim();
    const style = $el.attr("style")?.trim();
    const referrerpolicy = ($el.attr("referrerpolicy")?.trim() ?? undefined) as IframeEmbed["referrerpolicy"];
    const loading = ($el.attr("loading")?.trim() ?? "lazy") as IframeEmbed["loading"];

    out.push({
      src,
      variant: inferIframeVariant(src),
      title,
      width,
      height,
      sandbox,
      allow,
      style,
      referrerpolicy,
      loading,
    });
  });

  return out;
}

function isWidgetEmbed(embed: IframeEmbed): boolean {
  return (embed.variant ?? "default") !== "default";
}

function pagePathLooksImportant(path: string): boolean {
  const normalized = path.replace(/\/$/, "") || "/";
  if (normalized === "/") return true;
  if (/^\/about/i.test(normalized)) return true;
  if (/^\/contact/i.test(normalized)) return true;
  if (/^\/pricing/i.test(normalized) || /^\/membership/i.test(normalized) || /^\/join/i.test(normalized)) return true;
  if (/^\/schedule/i.test(normalized) || /^\/classes/i.test(normalized) || /^\/book/i.test(normalized)) return true;
  return false;
}

/**
 * Extract iframe widgets from every crawled page that signals a third-party
 * widget or maps to a generated page we care about. Returns a map keyed by
 * normalized source page path (e.g. "/schedule") with sanitized IframeEmbed
 * entries. Non-widget/default iframes (bug trackers, analytics, CDN loaders)
 * are dropped so they don't pollute generated pages.
 */
export async function extractCrawlPageIframes(
  crawl: MirrorCrawlArtifact,
  s3: S3Client,
  bucket: string,
): Promise<Map<string, IframeEmbed[]>> {
  const result = new Map<string, IframeEmbed[]>();
  // Only fetch pages that show signs of carrying a third-party widget.
  const widgetHostHint = /(?:calendar|schedule|booking|form|widget|maps?|youtube|vimeo|wistia|trustpilot|reputation|birdeye|embedsocial|leadconnector)/i;

  for (const page of crawl.pages) {
    const hasWidgetHint =
      page.embeds.some((host) => widgetHostHint.test(host)) ||
      page.dynamicRegions.some((r) => r.kind === "booking-widget" || r.kind === "schedule");
    if (!hasWidgetHint && !pagePathLooksImportant(page.path)) continue;

    const html = await fetchHtmlFromS3ByBucket(s3, bucket, page.htmlKey);
    if (!html) continue;

    const $ = cheerio.load(html);
    const embeds = extractPageIframeSections($).filter(isWidgetEmbed).map(sanitizeIframe);
    if (embeds.length > 0) {
      const key = page.path.replace(/\/$/, "") || "/";
      result.set(key, embeds);
    }
  }

  return result;
}

function extractTeam($: cheerio.CheerioAPI, baseUrl: string): { name: string; role?: string; bio?: string; photoUrl?: string }[] {
  const out: { name: string; role?: string; bio?: string; photoUrl?: string }[] = [];
  const seen = new Set<string>();

  const sectionSelectors = [
    "body > section",
    "main > section",
    "[class*='team']",
    "[class*='coach']",
    "[class*='staff']",
    "[class*='trainer']",
  ];

  $(sectionSelectors.join(", ")).each((_, section) => {
    const $section = $(section);
    // Prefer semantic containers (article/li) or explicitly styled cards. Only fall back
    // to generic team/staff wrapper divs when no finer-grained cards exist — otherwise a
    // single .team-grid wrapper swallows all members and only the first name is extracted.
    const semanticCards = $section.find("article, li").toArray();
    const styledCards = $section
      .find("[class*='card'], [class*='member'], [class*='coach'], [class*='trainer'], [class*='person']")
      .toArray();
    const cards =
      semanticCards.length > 0
        ? semanticCards
        : styledCards.length > 0
          ? styledCards
          : $section.find("[class*='team'] > div, [class*='staff'] > div").toArray();
    // If no dedicated cards, treat direct children divs as cards.
    const targets = cards.length > 0 ? cards : $section.children("div").toArray();

    for (const child of targets) {
      const $child = $(child);
      const name = $child.find("h3, h4, [class*='name'], [class*='title']").first().text().trim();
      if (!name || name.length < 2 || name.length > 80) continue;
      if (seen.has(name)) continue;
      seen.add(name);

      const role =
        $child.find("[class*='role'], [class*='position']").first().text().trim() || undefined;
      const bioText = $child.find("p").map((__, p) => $(p).text().trim()).get().filter(Boolean);
      const bio = bioText.find((t) => role && t !== role && t.length > 10) ?? bioText[0] ?? undefined;
      const rawImg = $child.find("img").first().attr("src");
      const photoUrl =
        rawImg && isSafeUrl(rawImg) ? (toAbsoluteUrl(rawImg, baseUrl) ?? rawImg) : undefined;

      out.push({ name, role, bio, photoUrl });
    }
  });

  return out;
}

function toAbsoluteUrl(raw: string, baseUrl: string): string | undefined {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return undefined;
  }
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
      if (!cta && t.length > 0 && t.length <= 60 && !href.startsWith("tel:") && !href.startsWith("mailto:") && isSafeUrl(href)) {
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
  const navLinks = extractNavLinks($);
  const navHierarchy = buildNavHierarchy(navLinks, crawl.sourceUrl);

  return {
    url: crawl.sourceUrl,
    title,
    businessName,
    description,
    headings: extractHeadings($).map((h) => h.text),
    paragraphs: extractParagraphs($),
    buttons: extractButtons($),
    navLinks,
    navHierarchy,
    colors,
    fonts: [],
    fontSizes: [],
    images: extractImages($),
    layoutRules: [],
    faqs: [],
    testimonials: [],
    locations: [],
    team: extractTeam($, crawl.origin),
    offerings: [],
    contact,
    sections: [...iframeSections, ...extractSections($)],
  };
}
