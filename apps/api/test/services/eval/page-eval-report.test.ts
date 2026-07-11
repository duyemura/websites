import { describe, test, expect } from "vitest";
import {
  scoreToGrade,
  issuesToScore,
  categoryPassed,
  computeOverallScore,
  finalizeReport,
  type PageEvalCategory,
  type PageEvalIssue,
} from "../../../src/services/eval/page-eval-report.js";

function cat(name: PageEvalCategory["name"], rawScore: number, issues: PageEvalIssue[] = []): PageEvalCategory {
  const score = issues.length > 0 ? issuesToScore(issues) : rawScore;
  return {
    name,
    score,
    grade: scoreToGrade(score),
    status: categoryPassed(score, issues) ? "passed" : "failed",
    issues,
  };
}

describe("page-eval-report scoring", () => {
  test("scoreToGrade maps thresholds correctly", () => {
    expect(scoreToGrade(98)).toBe("A+");
    expect(scoreToGrade(94)).toBe("A");
    expect(scoreToGrade(91)).toBe("A-");
    expect(scoreToGrade(88)).toBe("B+");
    expect(scoreToGrade(84)).toBe("B");
    expect(scoreToGrade(81)).toBe("B-");
    expect(scoreToGrade(78)).toBe("C+");
    expect(scoreToGrade(74)).toBe("C");
    expect(scoreToGrade(71)).toBe("C-");
    expect(scoreToGrade(65)).toBe("D");
    expect(scoreToGrade(55)).toBe("F");
  });

  test("issuesToScore floors to 0 on critical issues", () => {
    expect(issuesToScore([{ severity: "critical", category: "seo", message: "No title" }])).toBe(0);
  });

  test("issuesToScore applies penalties", () => {
    const issues: PageEvalIssue[] = [
      { severity: "major", category: "seo", message: "A" },
      { severity: "minor", category: "seo", message: "B" },
      { severity: "info", category: "seo", message: "C" },
    ];
    expect(issuesToScore(issues)).toBe(79);
  });

  test("categoryPassed requires 70+ and no critical issues", () => {
    expect(categoryPassed(75, [])).toBe(true);
    expect(categoryPassed(69, [])).toBe(false);
    expect(categoryPassed(75, [{ severity: "critical", category: "seo", message: "x" }])).toBe(false);
  });

  test("computeOverallScore uses weights", () => {
    const categories: PageEvalCategory[] = [
      cat("accessibility", 100),
      cat("seo", 0),
      cat("links", 100),
      cat("interactivity", 100),
      cat("performance", 100),
      cat("content", 100),
      cat("visual", 100),
    ];
    // accessibility 20% * 100 + seo 15% * 0 + rest 65% * 100 = 85
    expect(computeOverallScore(categories)).toBe(85);
  });

  test("finalizeReport fails when a critical issue exists", () => {
    const categories: PageEvalCategory[] = [
      cat("seo", 100, [{ severity: "critical", category: "seo", message: "Missing title" }]),
    ];
    const report = finalizeReport(categories, {
      url: "https://example.com/",
      path: "/",
      title: null,
      h1: null,
      wordCount: 0,
      loadTimeMs: 0,
    });
    expect(report.overall.status).toBe("failed");
    expect(report.overall.score).toBe(0);
    expect(report.overall.summary).toContain("critical");
  });

  test("buildSummary reports passing state", () => {
    const categories: PageEvalCategory[] = [
      cat("seo", 85, [{ severity: "minor", category: "seo", message: "short meta" }]),
    ];
    const report = finalizeReport(categories, {
      url: "https://example.com/",
      path: "/",
      title: "T",
      h1: "H",
      wordCount: 100,
      loadTimeMs: 500,
    });
    expect(report.overall.status).toBe("passed");
    expect(report.overall.summary).toContain("presentable");
  });

  test("finalizeReport produces clientSummary and prioritized actionItems", () => {
    const categories: PageEvalCategory[] = [
      cat("seo", 0, [
        { severity: "critical", category: "seo", message: "No title", fix: "Add a title" },
        { severity: "major", category: "seo", message: "No description", fix: "Add a description" },
      ]),
      cat("links", 90, [{ severity: "minor", category: "links", message: "Slow link", fix: "Check link" }]),
    ];
    const report = finalizeReport(categories, {
      url: "https://example.com/",
      path: "/",
      title: null,
      h1: null,
      wordCount: 0,
      loadTimeMs: 0,
    });
    expect(report.overall.clientSummary.length).toBeGreaterThan(0);
    expect(report.overall.actionItems.length).toBe(3);
    expect(report.overall.actionItems[0]?.priority).toBe("critical");
    expect(report.overall.actionItems[0]?.fix).toBe("Add a title");
  });
});
