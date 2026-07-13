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
  $("script, style, noscript, iframe, [aria-hidden='true']").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return { text, wordCount };
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
      issues.push({
        severity: issue.severity,
        category: "content",
        message: issue.message,
        fix: issue.fix,
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
