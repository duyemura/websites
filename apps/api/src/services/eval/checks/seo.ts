// apps/api/src/services/eval/checks/seo.ts
// On-page SEO structure audit.

import * as cheerio from "cheerio";
import type { CheckContext } from "./check-context.js";
import type { PageEvalCategory, PageEvalIssue } from "../page-eval-report.js";
import { categoryPassed, issuesToScore, scoreToGrade } from "../page-eval-report.js";

export async function checkSeo(ctx: CheckContext): Promise<PageEvalCategory> {
  const html = await ctx.page.content();
  const $ = cheerio.load(html);
  const issues: PageEvalIssue[] = [];

  const title = $("title").text().trim();
  if (!title) {
    issues.push({
      severity: "critical",
      category: "seo",
      message: "Missing <title> tag",
      fix: "Add a unique, descriptive <title> for this page.",
      selector: "title",
    });
  } else if (title.length < 10) {
    issues.push({
      severity: "major",
      category: "seo",
      message: `Title is too short (${title.length} chars): "${title}"`,
      fix: "Expand the title to 30–60 characters with the page topic and gym name.",
      selector: "title",
    });
  } else if (title.length > 60) {
    issues.push({
      severity: "minor",
      category: "seo",
      message: `Title may be truncated in search results (${title.length} chars)`,
      fix: "Trim the title to 50–60 characters while keeping the page topic and gym name.",
      selector: "title",
    });
  }

  const metaDescription = $('meta[name="description"]').attr("content")?.trim();
  if (!metaDescription) {
    issues.push({
      severity: "major",
      category: "seo",
      message: "Missing meta description",
      fix: "Add a meta description (120–160 characters) summarizing the page.",
      selector: "meta[name='description']",
    });
  } else if (metaDescription.length < 50) {
    issues.push({
      severity: "minor",
      category: "seo",
      message: `Meta description is too short (${metaDescription.length} chars)`,
      fix: "Expand the description to 120–160 characters summarizing the page value.",
      selector: "meta[name='description']",
    });
  } else if (metaDescription.length > 160) {
    issues.push({
      severity: "minor",
      category: "seo",
      message: `Meta description may be truncated (${metaDescription.length} chars)`,
      fix: "Trim the description to 120–160 characters so it is not cut off in search results.",
      selector: "meta[name='description']",
    });
  }

  const canonical = $('link[rel="canonical"]').attr("href")?.trim();
  if (!canonical) {
    issues.push({
      severity: "minor",
      category: "seo",
      message: "Missing canonical link",
      fix: "Add <link rel='canonical' href='...'> to avoid duplicate-content issues.",
      selector: "link[rel='canonical']",
    });
  }

  const h1s = $("h1");
  if (h1s.length === 0) {
    issues.push({
      severity: "critical",
      category: "seo",
      message: "No H1 heading found",
      fix: "Every page needs exactly one H1 describing the page topic.",
      selector: "h1",
    });
  } else if (h1s.length > 1) {
    issues.push({
      severity: "major",
      category: "seo",
      message: `${h1s.length} H1 headings found — should be exactly one`,
      fix: "Keep only the most important page heading as H1; convert the rest to H2 or lower.",
      selector: "h1",
    });
  }

  // Heading hierarchy: no skipped levels (h1 → h3 without h2, etc.)
  const headings = $("h1, h2, h3, h4, h5, h6");
  let lastLevel = 0;
  headings.each((_, el) => {
    const tag = String(el.tagName ?? "");
    const level = Number.parseInt(tag[1] ?? "0", 10);
    if (level > lastLevel + 1) {
      issues.push({
        severity: "minor",
        category: "seo",
        message: `Skipped heading level: ${tag} follows ${lastLevel === 0 ? "none" : `h${lastLevel}`}`,
        fix: "Restructure headings so each level increments by one (h1 → h2 → h3).",
        selector: tag,
      });
    }
    lastLevel = level;
  });

  // Image alt text
  $("img").each((_, el) => {
    const alt = $(el).attr("alt");
    const src = $(el).attr("src") ?? "";
    // Decorative images can use alt="", but only if explicitly marked
    if (alt === undefined && !src.startsWith("data:")) {
      issues.push({
        severity: "major",
        category: "seo",
        message: `Image missing alt text: ${src.slice(0, 80)}`,
        fix: "Add descriptive alt text, or alt='' for decorative images.",
        selector: `img[src*="${src.replace(/"/g, "\\\"").slice(0, 40)}"]`,
      });
    }
  });

  // Open Graph
  if (!$('meta[property^="og:"]').length) {
    issues.push({
      severity: "minor",
      category: "seo",
      message: "Missing Open Graph tags",
      fix: "Add og:title, og:description, and og:image for social sharing.",
    });
  }

  // JSON-LD
  const jsonLdScripts = $('script[type="application/ld+json"]');
  if (jsonLdScripts.length === 0) {
    issues.push({
      severity: "major",
      category: "seo",
      message: "No JSON-LD structured data found",
      fix: "Add LocalBusiness JSON-LD with name, address, phone, and URL.",
    });
  } else {
    jsonLdScripts.each((_, el) => {
      const raw = $(el).text().trim();
      try {
        JSON.parse(raw);
      } catch {
        issues.push({
          severity: "major",
          category: "seo",
          message: "JSON-LD script contains invalid JSON",
          fix: "Fix the JSON-LD syntax so search engines can parse it.",
          selector: "script[type='application/ld+json']",
        });
      }
    });
  }

  const score = issuesToScore(issues);
  return {
    name: "seo",
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}
