// apps/api/src/services/eval/checks/content.ts
// Content quality check: deterministic placeholder/business-info checks plus
// lightweight LLM scoring for readability, keyword usage, and sense-making.

import * as cheerio from "cheerio";
import type { CheckContext } from "./check-context.js";
import type { PageEvalCategory, PageEvalIssue } from "../page-eval-report.js";
import { categoryPassed, issuesToScore, scoreToGrade } from "../page-eval-report.js";
import {
  auditPage,
  buildAllowedPaths,
} from "../../template/rendered-audit.js";
import { callLlmAndLog } from "../../../ai/llm-with-logging.js";
import type { Config } from "../../../plugins/env";
import { checkTemplateFidelity, checkStructureFidelity } from "./fidelity.js";

const MAX_LLM_TEXT = 12000;

function extractVisibleText(html: string): { text: string; wordCount: number } {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, [aria-hidden='true'], [data-eval-ignore]").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { text, wordCount };
}

interface SectionDepth {
  heading: string;
  bodyWordCount: number;
  hasBody: boolean;
}

/**
 * Find sections where a heading is present but little or no body copy follows it.
 * This catches the common generated-page failure: section shells with only headings.
 */
export function findShallowSections(html: string): SectionDepth[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, [aria-hidden='true'], [data-eval-ignore]").remove();
  const shallow: SectionDepth[] = [];

  // Sections marked by semantic <section> or explicit data-section/data-section-tag.
  // This is the generated-page failure we care about: a section shell with only a heading.
  // Hero bands and page H1 headers are normal shells, not missing content.
  $("section:not([data-section='hero']), [data-section]:not([data-section='hero']), [data-section-tag]")
    .each((_, el) => {
    const $el = $(el);
    // CTA bands are intentionally short call-to-action shells (heading + one line + button).
    // They are not content sections and should never be flagged as shallow.
    const sectionTag = $el.attr("data-section-tag") ?? "";
    const sectionName = $el.attr("data-section") ?? "";
    const isCtaBand = sectionTag === "cta-band" || sectionName === "ctaBand" || sectionName === "cta";
    if (isCtaBand) return;
    const headingEl = $el.find("h1, h2, h3").first();
    const heading = headingEl.text().trim();
    if (!heading || heading.split(/\s+/).length > 12) return; // only plausible section headings
    // A page hero that only contains the H1 is a normal header band, not an empty shell.
    if (headingEl.prop("tagName")?.toLowerCase() === "h1") return;
    // Count visible body words inside the same section, excluding the heading text.
    const fullText = $el.text().replace(/\s+/g, " ").trim();
    const bodyText = fullText.replace(heading, "").trim();
    const bodyWordCount = bodyText.split(/\s+/).filter(Boolean).length;
    if (bodyWordCount < 15) {
      // A section that is just a heading + one CTA link/button is a call-out band,
      // not an empty content section. Skip it so we don't flag legitimate CTAs.
      const hasBodyCopy = $el.find("p, ul, ol, dl, blockquote").length > 0;
      const interactiveCount = $el.find("a, button").length;
      if (!hasBodyCopy && interactiveCount <= 2) {
        return;
      }
      shallow.push({ heading, bodyWordCount, hasBody: false });
    }
  });

  return shallow;
}

/** Truncate text at a safe boundary for the LLM prompt. */
function truncateForLlm(text: string, max: number): string {
  if (text.length <= max) return text;
  // Walk back from the limit to the nearest sentence or clause boundary
  // so the model never sees a fragment like "Are classes s".
  const clipped = text.slice(0, max);
  const boundary = /[.!?](?:\s|$)/;
  let cut = max;
  for (let i = max - 1; i > max * 0.75; i--) {
    if (boundary.test(clipped.slice(i, i + 2))) {
      cut = i + 1;
      break;
    }
  }
  return text.slice(0, cut).trim() + "\n\n[Page text continues beyond this point.]";
}

/** Reject LLM issues that duplicate deterministic checks or stray into layout/visual territory. */
function isLlmCopyIssue(message: string): boolean {
  const lower = message.toLowerCase();
  const blocked = [
    "sections have headings but almost no body copy",
    "heading is very close",
    "heading appears to be too close",
    "navigation links",
    "navigation menu",
    "button text is cut off",
    "button is partially obscured",
    "button text is wrapping",
    "copyright year",
    "future",
    "cut off",
    "obscured",
    "visual design",
    "layout",
    "spacing",
  ];
  return !blocked.some((b) => lower.includes(b));
}

/**
 * Service-area program city pages intentionally use the gym's real name/address
 * while targeting nearby cities in the H1/title for local SEO. The LLM often
 * flags this as a location mismatch, but it is a product choice, not a
 * critical content bug, so we downgrade those issues to major.
 */
function sanitizeLlmContentIssue<T extends { severity: PageEvalIssue["severity"]; message: string }>(
  issue: T,
  path: string,
): T {
  if (!path.match(/^\/programs\/[^/]+\/[^/]+$/)) return issue;
  const lower = issue.message.toLowerCase();
  const isLocationMismatch =
    lower.includes("inconsistent location") ||
    lower.includes("location information") ||
    (lower.includes("h1 states") && lower.includes("refers to")) ||
    (lower.includes("title and h1") && lower.includes("refers to"));
  if (isLocationMismatch && issue.severity === "critical") {
    return { ...issue, severity: "major" };
  }
  return issue;
}

function deriveKeywords(content: CheckContext["content"], path: string): string[] {
  const kw: string[] = [];
  if (content?.business?.name) kw.push(content.business.name);
  if (content?.business?.geo?.city) kw.push(content.business.geo.city);
  if (content?.business?.geo?.state) kw.push(content.business.geo.state);
  if (content?.business?.geo?.stateAbbr) kw.push(content.business.geo.stateAbbr);
  if (path.startsWith("/programs/") && content?.pages.programs) {
    const slug = path.replace("/programs/", "").replace(/\/$/, "");
    const program = content.pages.programs.find((p) => p.slug === slug);
    if (program?.name) kw.push(program.name);
  }
  return Array.from(new Set(kw.filter(Boolean)));
}

interface LlmContentResult {
  readability: number;
  keywordUsage: number;
  senseMaking: number;
  issues: Array<{ severity: "critical" | "major" | "minor" | "info"; message: string; fix?: string }>;
}

async function llmContentReview(
  ctx: CheckContext,
  text: string,
  title: string,
  h1: string | null,
  keywords: string[],
  config: Config,
): Promise<LlmContentResult | null> {
  const userUuid = await ctx.db
    .selectFrom("workspaceMemberships")
    .select("userUuid")
    .where("workspaceUuid", "=", ctx.workspaceUuid)
    .limit(1)
    .executeTakeFirst()
    .then((r) => r?.userUuid ?? "system");

  try {
    const result = await callLlmAndLog(
      {
        db: ctx.db,
        workspaceUuid: ctx.workspaceUuid,
        userUuid,
        siteUuid: ctx.siteUuid,
      },
      {
        agent: "page-eval-content",
        actionType: "qa",
        promptTemplateKeys: ["page-eval-content"],
        summary: "LLM content quality review for page eval",
        messages: [
          {
            role: "system",
            content:
              "You are a senior agency copy editor evaluating a single gym website page. " +
              "Score readability (0-100), keyword usage (0-100), and whether the words make sense (0-100). " +
              "Detect placeholder text, nonsense phrases, grammar problems, and missing business context. " +
              "Only report copy-quality issues (placeholder text, grammar, factual oddities, keyword usage). " +
              "Do NOT report section length, heading-to-body spacing, layout, navigation, buttons, copyright years, or visual design — those are checked by separate tools. " +
              "Return strictly valid JSON with keys: readability, keywordUsage, senseMaking, issues. " +
              "Each issue must have severity (critical/major/minor/info) and message. Optional fix string.",
          },
          {
            role: "user",
            content:
              `Page title: ${title}\n` +
              `H1: ${h1 ?? "none"}\n` +
              `Target keywords/phrases: ${keywords.join(", ") || "none provided"}\n\n` +
              `Page text:\n${truncateForLlm(text, MAX_LLM_TEXT)}`,
          },
        ],
        jsonMode: true,
        temperature: 0.3,
        maxTokens: 1500,
      },
      config,
    );

    if (result.outcome !== "success" || !result.response.content) return null;
    const parsed = JSON.parse(result.response.content) as LlmContentResult;
    return {
      readability: Math.max(0, Math.min(100, Number(parsed.readability) || 0)),
      keywordUsage: Math.max(0, Math.min(100, Number(parsed.keywordUsage) || 0)),
      senseMaking: Math.max(0, Math.min(100, Number(parsed.senseMaking) || 0)),
      issues: parsed.issues ?? [],
    };
  } catch (err) {
    ctx.log(`LLM content review failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function checkContent(ctx: CheckContext, config: Config): Promise<PageEvalCategory> {
  const html = await ctx.page.content();
  const { text, wordCount } = extractVisibleText(html);
  const issues: PageEvalIssue[] = [];

  if (wordCount < 50) {
    issues.push({
      severity: "major",
      category: "content",
      message: `Page has only ${wordCount} visible words — likely missing content`,
      fix: "Add substantive copy explaining the page topic, gym, and call-to-action.",
    });
  }

  const shallowSections = findShallowSections(html);
  if (shallowSections.length > 0) {
    const sampleHeadings = shallowSections.slice(0, 3).map((s) => `"${s.heading}"`).join(", ");
    issues.push({
      severity: "critical",
      category: "content",
      message: `${shallowSections.length} section${shallowSections.length === 1 ? "" : "s"} have headings but almost no body copy (${sampleHeadings}${shallowSections.length > 3 ? "…" : ""}). Page looks empty to visitors and search engines.`,
      fix: "Write 2–4 sentences under each heading explaining the section topic for this specific page.",
    });
  }

  // Program landing pages should answer the core questions; generic shells fail.
  if (ctx.path.startsWith("/programs/") && !ctx.path.endsWith("/programs/")) {
    const $ = cheerio.load(html);
    $("script, style, noscript, iframe, [aria-hidden='true'], [data-eval-ignore]").remove();
    const headings = $("section, [data-section], [data-section-tag]")
      .map((_, el) => $(el).find("h1, h2, h3").first().text().trim())
      .get()
      .filter(Boolean)
      .map((h) => h.toLowerCase());
    const hasWhat = headings.some((h) => h.includes("what is") || h.includes("about") || h.includes("program"));
    const hasWho = headings.some((h) => h.includes("who") || h.includes("for"));
    const hasExpect = headings.some((h) => h.includes("expect") || h.includes("what to") || h.includes("how it"));
    if (!hasWhat || !hasWho || !hasExpect) {
      issues.push({
        severity: "major",
        category: "content",
        message: "Program page is missing one or more core explanatory sections: what the program is, who it is for, or what to expect.",
        fix: "Add clear sections that explain the program, the ideal member, and the experience/schedule.",
      });
    }
  }

  // Deterministic business/placeholder audit if we have gym.json
  if (ctx.content) {
    const allowedPaths = buildAllowedPaths(ctx.content);
    const links = await ctx.page.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? "")
        .filter((h) => h.startsWith("/")),
    );
    const audit = auditPage(ctx.path, html, ctx.content.business, allowedPaths, links);
    for (const f of audit.failures) {
      issues.push({
        severity: f.fixable ? "major" : "critical",
        category: "content",
        message: f.message,
        fix: f.fix,
        selector: f.page,
      });
    }
    for (const w of audit.warnings) {
      issues.push({ severity: "minor", category: "content", message: w });
    }

    // Template + structure fidelity checks.
    const fidelityIssues = await checkTemplateFidelity(ctx);
    const structureIssues = await checkStructureFidelity(ctx);
    issues.push(...fidelityIssues, ...structureIssues);
  } else {
    issues.push({
      severity: "info",
      category: "content",
      message: "No gym.json content available — business-info, placeholder, and fidelity checks skipped",
    });
  }

  const title = await ctx.page.title();
  const h1 = await ctx.page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? null);
  const keywords = ctx.keywords?.length ? ctx.keywords : deriveKeywords(ctx.content, ctx.path);

  const llm = await llmContentReview(ctx, text, title, h1, keywords, config);
  let score = issuesToScore(issues);
  if (llm) {
    // Blend deterministic score (60%) with LLM average (40%)
    const llmAvg = Math.round((llm.readability + llm.keywordUsage + llm.senseMaking) / 3);
    score = Math.round(score * 0.6 + llmAvg * 0.4);
    for (const issue of llm.issues) {
      if (!isLlmCopyIssue(issue.message)) continue;
      const sanitized = sanitizeLlmContentIssue(issue, ctx.path);
      // LLM content feedback is copy-editor judgment, not a hard blocker. Cap it at
      // major so deterministic checks (placeholder text, shallow sections, factual
      // audit failures) remain the only source of critical content issues.
      const severity: PageEvalIssue["severity"] =
        sanitized.severity === "critical" ? "major" : sanitized.severity;
      issues.push({
        severity,
        category: "content",
        message: sanitized.message,
        fix: sanitized.fix,
      });
    }
  }

  return {
    name: "content",
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}
