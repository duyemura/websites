import { describe, test, expect } from "vitest";
import { buildSiteEvalReport, finalizeReport, scoreToGrade } from "../page-eval-report.js";
import type { PageEvalReport, PageEvalCategory, PageEvalMetadata } from "../page-eval-report.js";

function makeCategory(name: PageEvalCategory["name"], issues: PageEvalCategory["issues"]): PageEvalCategory {
  return { name, score: 100, grade: "A+", status: "passed", issues };
}

function makeReport(path: string, score: number, issues: PageEvalCategory["issues"], title?: string): PageEvalReport {
  const categories: PageEvalCategory[] = issues.length
    ? [makeCategory("content", issues)]
    : [makeCategory("content", [])];
  // Override the first category score/grade/status based on the desired overall score.
  const anyCritical = issues.some((i) => i.severity === "critical");
  const status = anyCritical || score < 70 ? "failed" : "passed";
  categories[0]!.score = score;
  categories[0]!.grade = scoreToGrade(score);
  categories[0]!.status = status;

  const metadata: PageEvalMetadata = {
    url: `https://example.com${path}`,
    path,
    title: title ?? null,
    h1: null,
    wordCount: 0,
    loadTimeMs: 0,
  };

  return {
    overall: {
      score,
      grade: scoreToGrade(score),
      status,
      summary: "test summary",
      clientSummary: "test client summary",
      actionItems: [],
    },
    categories,
    metadata,
  };
}

describe("buildSiteEvalReport", () => {
  test("aggregates a single page", () => {
    const report = makeReport("/", 85, [], "Home");
    const siteReport = buildSiteEvalReport([report]);

    expect(siteReport.summary).toMatchObject({
      totalPages: 1,
      passedPages: 1,
      failedPages: 0,
      avgScore: 85,
      minScore: 85,
      maxScore: 85,
      worstPath: "/",
      totalIssues: 0,
      criticalIssues: 0,
    });
    expect(siteReport.summaries[0]).toMatchObject({
      path: "/",
      score: 85,
      grade: "B",
      status: "passed",
      title: "Home",
      totalIssues: 0,
      criticalIssues: 0,
    });
  });

  test("identifies worst page and average score across multiple pages", () => {
    const home = makeReport("/", 95, [], "Home");
    const about = makeReport("/about", 62, [{ severity: "major", category: "content", message: "Thin content" }], "About");
    const contact = makeReport("/contact", 88, [], "Contact");

    const siteReport = buildSiteEvalReport([home, about, contact]);

    expect(siteReport.summary.totalPages).toBe(3);
    expect(siteReport.summary.passedPages).toBe(2);
    expect(siteReport.summary.failedPages).toBe(1);
    expect(siteReport.summary.avgScore).toBe(82); // round((95+62+88)/3) = 81.67 → 82
    expect(siteReport.summary.minScore).toBe(62);
    expect(siteReport.summary.maxScore).toBe(95);
    expect(siteReport.summary.worstPath).toBe("/about");
    expect(siteReport.summary.totalIssues).toBe(1);
  });

  test("counts critical issues across pages", () => {
    const home = makeReport("/", 50, [{ severity: "critical", category: "content", message: "Missing hero" }]);
    const about = makeReport("/about", 50, [
      { severity: "critical", category: "content", message: "Missing title" },
      { severity: "major", category: "content", message: "Thin content" },
    ]);

    const siteReport = buildSiteEvalReport([home, about]);

    expect(siteReport.summary.criticalIssues).toBe(2);
    expect(siteReport.summary.totalIssues).toBe(3);
    expect(siteReport.summary.passedPages).toBe(0);
    expect(siteReport.summary.failedPages).toBe(2);
  });

  test("returns zeroed summary for empty input", () => {
    const siteReport = buildSiteEvalReport([]);
    expect(siteReport.summary).toMatchObject({
      totalPages: 0,
      passedPages: 0,
      failedPages: 0,
      avgScore: 0,
      minScore: 0,
      maxScore: 0,
      worstPath: "",
      totalIssues: 0,
      criticalIssues: 0,
    });
  });
});

describe("finalizeReport", () => {
  test("computes overall grade and action items from categories", () => {
    const categories: PageEvalCategory[] = [
      { name: "seo", score: 100, grade: "A+", status: "passed", issues: [] },
      { name: "content", score: 30, grade: "F", status: "failed", issues: [{ severity: "major", category: "content", message: "Thin content" }] },
    ];
    const report = finalizeReport(categories, {
      url: "https://example.com/",
      path: "/",
      title: "Home",
      h1: "Welcome",
      wordCount: 100,
      loadTimeMs: 500,
    });

    expect(report.overall.status).toBe("failed");
    expect(report.overall.score).toBeLessThan(100);
    expect(report.overall.grade).toBeDefined();
    expect(report.overall.actionItems).toHaveLength(1);
    expect(report.overall.actionItems[0]?.priority).toBe("major");
  });
});
