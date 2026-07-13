// apps/api/src/services/eval/checks/performance.ts
// Performance scoring via Playwright navigation timing and Lighthouse when available.

import type { Page } from "playwright";
import type { CheckContext } from "./check-context.js";
import type { PageEvalCategory, PageEvalIssue } from "../page-eval-report.js";
import { categoryPassed, scoreToGrade } from "../page-eval-report.js";
import { runLighthouse } from "../../../utils/pipeline/source-baseline.js";

async function resolveDebugPort(page: Page): Promise<number | null> {
  try {
    const session = await page.context().newCDPSession(page);
    const info = (await session.send("Browser.getVersion")) as {
      webSocketDebuggerUrl?: string;
    };
    await session.detach().catch(() => {});
    if (!info.webSocketDebuggerUrl) return null;
    const port = new URL(info.webSocketDebuggerUrl).port;
    const num = port ? Number(port) : NaN;
    return Number.isFinite(num) && num > 0 ? num : null;
  } catch {
    return null;
  }
}

function scoreFromLoadTime(loadMs: number): number {
  if (loadMs <= 2000) return 100;
  if (loadMs <= 3000) return 85;
  if (loadMs <= 5000) return 70;
  if (loadMs <= 8000) return 50;
  return 30;
}

export async function checkPerformance(ctx: CheckContext): Promise<PageEvalCategory> {
  const issues: PageEvalIssue[] = [];

  const timing = await ctx.page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (!nav) return null;
    return {
      loadEventEnd: nav.loadEventEnd,
      domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
      largestContentfulPaint: (performance.getEntriesByType("paint") as PerformancePaintTiming[])
        .find((p) => p.name === "largest-contentful-paint")?.startTime ?? 0,
      firstContentfulPaint: (performance.getEntriesByType("paint") as PerformancePaintTiming[])
        .find((p) => p.name === "first-contentful-paint")?.startTime ?? 0,
    };
  });

  let playWrightScore = 70;
  if (timing) {
    playWrightScore = scoreFromLoadTime(timing.loadEventEnd);
    if (timing.loadEventEnd > 5000) {
      issues.push({
        severity: "major",
        category: "performance",
        message: `Page load time is ${Math.round(timing.loadEventEnd / 1000)}s`,
        fix: "Reduce render-blocking resources, compress images, or lazy-load below-the-fold content.",
      });
    } else if (timing.loadEventEnd > 3000) {
      issues.push({
        severity: "minor",
        category: "performance",
        message: `Page load time is ${Math.round(timing.loadEventEnd / 1000)}s`,
      });
    }
  }

  // Try Lighthouse if we have a debug port
  let lighthouseScores: { performance: number; accessibility: number; bestPractices: number; seo: number } | null = null;
  const debugPort = await resolveDebugPort(ctx.page);
  if (debugPort) {
    const lhMobile = await runLighthouse(ctx.url, ctx.path, "mobile", debugPort);
    const lhDesktop = await runLighthouse(ctx.url, ctx.path, "desktop", debugPort);
    const scores = [lhMobile, lhDesktop].filter(Boolean);
    if (scores.length > 0) {
      lighthouseScores = {
        performance: Math.round(scores.reduce((a, s) => a + s!.performance, 0) / scores.length),
        accessibility: Math.round(scores.reduce((a, s) => a + s!.accessibility, 0) / scores.length),
        bestPractices: Math.round(scores.reduce((a, s) => a + s!.bestPractices, 0) / scores.length),
        seo: Math.round(scores.reduce((a, s) => a + s!.seo, 0) / scores.length),
      };
      if (lighthouseScores.performance < 70) {
        issues.push({
          severity: "major",
          category: "performance",
          message: `Lighthouse performance score is ${lighthouseScores.performance}`,
          fix: "Optimize images, eliminate render-blocking resources, and reduce JavaScript.",
        });
      }
      if (lighthouseScores.accessibility < 70) {
        issues.push({
          severity: "major",
          category: "performance",
          message: `Lighthouse accessibility score is ${lighthouseScores.accessibility}`,
          fix: "Address the accessibility violations flagged in the accessibility category.",
        });
      }
    }
  }

  // Blend Playwright timing and Lighthouse performance if available
  const score = lighthouseScores?.performance
    ? Math.round(lighthouseScores.performance * 0.7 + playWrightScore * 0.3)
    : playWrightScore;

  return {
    name: "performance",
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}
