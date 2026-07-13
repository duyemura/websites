import * as cheerio from "cheerio";
import type { AssetAppearance } from "../../types/mirror";

const SECTION_SELECTORS = [
  "body > section",
  "body > article",
  "main > section",
  "main > article",
  "main > div",
  "[class*='section']",
  "[class*='hero']",
  "[class*='block']",
  "[class*='content']",
].join(", ");

export function inferSectionType(cls: string, heading?: string): string {
  const lower = `${cls} ${heading ?? ""}`.toLowerCase();
  if (/\bhero\b/.test(lower)) return "hero";
  if (/\btestimonial|\breview|\bmember story/.test(lower)) return "testimonial";
  if (/\bpricing|\bplan|\bmembership|\bpackage/.test(lower)) return "pricing";
  if (/\bfaq|\bfrequently asked/.test(lower)) return "faq";
  if (/\bteam|\bcoach|\btrainer|\bstaff/.test(lower)) return "team";
  if (/\blocation|\bcontact|\bfind us|\bvisit/.test(lower)) return "location";
  if (/\bcta|\bcall.to.action/.test(lower)) return "cta";
  if (/\bfeature|\bbenefit|\bservice|\bprogram|\bclass/.test(lower)) return "feature-grid";
  if (/\bstep|\bprocess|\bhow it works/.test(lower)) return "steps";
  if (/\bgallery|\bimage|\bmedia/.test(lower)) return "media";
  if (/\bblog|\barticle|\bnews|\brecipe|\bnutrition/.test(lower)) return "blog";
  if (/\babout|\bstory|\bmision/.test(lower)) return "about";
  return "section";
}

function toAbsoluteUrl(raw: string, base: string): string | null {
  try {
    return new URL(raw, base).toString();
  } catch {
    return null;
  }
}

/**
 * Extract the page/section context for every content image in the HTML.
 * Used to match scraped images to generated sections by topic.
 */
export function extractImageContexts(
  html: string,
  pageUrl: string,
  pagePath: string,
): AssetAppearance[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const contexts: AssetAppearance[] = [];

  // Strip script/style so they don't pollute section text extraction.
  $("script, style, noscript, iframe").remove();

  $(SECTION_SELECTORS).each((_, section) => {
    const $section = $(section);
    const cls = $section.attr("class") ?? "";

    let sectionHeading: string | undefined;
    $section.find("h1, h2, h3")
      .each((__, h) => {
        const t = $(h).text().trim();
        if (!sectionHeading && t.length >= 3 && t.length <= 200) sectionHeading = t;
      });

    let sectionBody: string | undefined;
    $section.find("p").each((__, p) => {
      const t = $(p).text().trim();
      if (!sectionBody && t.length > 30 && t.length < 400) sectionBody = t;
    });

    const sectionType = inferSectionType(cls, sectionHeading);

    $section.find("img").each((__, img) => {
      const src = $(img).attr("src");
      if (!src || src.startsWith("data:")) return;
      const abs = toAbsoluteUrl(src, pageUrl);
      if (!abs) return;
      // Deduplicate within the same page/section.
      const key = `${abs}::${sectionType}::${sectionHeading ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      contexts.push({
        originalUrl: abs,
        pagePath,
        sectionType,
        sectionHeading: sectionHeading || undefined,
        sectionBody: sectionBody || undefined,
      });
    });
  });

  return contexts;
}
