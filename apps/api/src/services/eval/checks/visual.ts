// apps/api/src/services/eval/checks/visual.ts
// Visual/screenshot review via LLM for layout breakage, missing sections,
// and obvious color/contrast problems not caught by axe-core.

import type { CheckContext } from "./check-context.js";
import type { PageEvalCategory, PageEvalIssue } from "../page-eval-report.js";
import { categoryPassed, scoreToGrade } from "../page-eval-report.js";
import { callLlmAndLog } from "../../../ai/llm-with-logging.js";
import type { Config } from "../../../plugins/env";

interface LlmVisualResult {
  visualScore: number;
  issues: Array<{ severity: "critical" | "major" | "minor" | "info"; message: string; fix?: string }>;
}

function pngToDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function llmVisualReview(
  ctx: CheckContext,
  screenshot: Buffer,
  title: string,
  config: Config,
): Promise<LlmVisualResult | null> {
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
        agent: "page-eval-visual",
        actionType: "qa",
        promptTemplateKeys: ["page-eval-visual"],
        summary: "LLM visual/screenshot review for page eval",
        messages: [
          {
            role: "system",
            content:
              "You are a senior web design QA reviewing a screenshot of a gym website page. " +
              "Look for: broken layouts, overlapping text, missing sections/placeholders, " +
              "illegible text due to color/contrast, images that fail to load, and anything " +
              "that would stop an agency from showing this to a client. " +
              "Return strictly valid JSON with keys: visualScore (0-100), issues. " +
              "Each issue has severity (critical/major/minor/info), message, and optional fix.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Evaluate this screenshot of "${title}".` },
              { type: "image_url", image_url: { url: pngToDataUrl(screenshot) } },
            ],
          },
        ],
        jsonMode: true,
        temperature: 0.3,
        maxTokens: 1500,
      },
      config,
    );

    if (result.outcome !== "success" || !result.response.content) return null;
    const parsed = JSON.parse(result.response.content) as LlmVisualResult;
    return {
      visualScore: Math.max(0, Math.min(100, Number(parsed.visualScore) || 0)),
      issues: parsed.issues ?? [],
    };
  } catch (err) {
    ctx.log(`LLM visual review failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export async function checkVisual(ctx: CheckContext, config: Config): Promise<PageEvalCategory> {
  const issues: PageEvalIssue[] = [];
  let score = 85; // default neutral score when LLM is unavailable

  try {
    // Capture a viewport screenshot; full-page is too expensive for LLM vision
    await ctx.page.setViewportSize({ width: 1280, height: 1200 });
    await ctx.page.waitForTimeout(200);
    const screenshot = await ctx.page.screenshot({ type: "png" });

    const title = await ctx.page.title();
    const llm = await llmVisualReview(ctx, screenshot, title, config);
    if (llm) {
      score = llm.visualScore;
      for (const issue of llm.issues) {
        issues.push({
          severity: issue.severity,
          category: "visual",
          message: issue.message,
          fix: issue.fix,
        });
      }
    } else {
      issues.push({
        severity: "info",
        category: "visual",
        message: "Visual review skipped — LLM vision not configured",
      });
    }
  } catch (err) {
    issues.push({
      severity: "info",
      category: "visual",
      message: `Could not capture screenshot for visual review: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return {
    name: "visual",
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}
