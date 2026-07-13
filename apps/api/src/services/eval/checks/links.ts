// apps/api/src/services/eval/checks/links.ts
// Validates that links on the page resolve and are not placeholders.

import type { CheckContext } from "./check-context.js";
import type { PageEvalCategory, PageEvalIssue } from "../page-eval-report.js";
import { categoryPassed, issuesToScore, scoreToGrade } from "../page-eval-report.js";

const PLACEHOLDER_DOMAINS = ["example.com", "yourgym.com", "yourdomain.com", "example.org", "placeholder.com"];

function isExternal(href: string): boolean {
  return /^(https?:|mailto:|tel:|#|\/\/)/i.test(href);
}

function isPlaceholderDomain(href: string): boolean {
  try {
    const url = new URL(href);
    return PLACEHOLDER_DOMAINS.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export async function checkLinks(ctx: CheckContext): Promise<PageEvalCategory> {
  const issues: PageEvalIssue[] = [];
  const seen = new Set<string>();

  const links = await ctx.page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
      .filter(Boolean),
  );

  const pageUrl = new URL(ctx.url);

  for (const href of links) {
    if (seen.has(href)) continue;
    seen.add(href);

    if (href.startsWith("mailto:") || href.startsWith("tel:") || href === "#") continue;

    // Placeholder domain detection
    if (isPlaceholderDomain(href)) {
      issues.push({
        severity: "critical",
        category: "links",
        message: `Link uses placeholder domain: ${href}`,
        fix: "Replace with the real gym URL or remove the link.",
        selector: `a[href="${href}"]`,
      });
      continue;
    }

    // Skip external links for reachability (we don't want to crawl the web)
    if (isExternal(href) && !href.startsWith(pageUrl.origin)) continue;

    // Internal link: resolve against origin and check it returns 2xx
    try {
      const resolved = href.startsWith("/") ? `${pageUrl.origin}${href}` : new URL(href, pageUrl).href;
      const response = await ctx.page.evaluate(
        async (url) => {
          try {
            const res = await fetch(url, { method: "HEAD" });
            return res.status;
          } catch {
            return 0;
          }
        },
        resolved,
      );
      if (response >= 400) {
        issues.push({
          severity: "major",
          category: "links",
          message: `Internal link returned HTTP ${response}: ${href}`,
          fix: "Fix or remove the broken link.",
          selector: `a[href="${href}"]`,
        });
      }
    } catch (err) {
      issues.push({
        severity: "minor",
        category: "links",
        message: `Could not verify link: ${href} — ${err instanceof Error ? err.message : String(err)}`,
        selector: `a[href="${href}"]`,
      });
    }
  }

  // Check anchor targets exist
  const anchors = links
    .filter((h) => h.startsWith("#") && h.length > 1)
    .map((h) => h.slice(1));
  for (const id of anchors) {
    const exists = await ctx.page.evaluate((target) => !!document.getElementById(target), id);
    if (!exists) {
      issues.push({
        severity: "minor",
        category: "links",
        message: `Anchor link #${id} has no matching element`,
        fix: `Add id="${id}" to the target element or remove the anchor link.`,
        selector: `a[href="#${id}"]`,
      });
    }
  }

  const score = issuesToScore(issues);
  return {
    name: "links",
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}
