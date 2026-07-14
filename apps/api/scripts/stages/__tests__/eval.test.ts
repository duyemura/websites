import { describe, test, expect, vi, beforeEach } from "vitest";
import { evalStage } from "../eval.js";
import type { StageContext } from "../types";
import type { SiteEvalReport } from "../../../src/services/eval/page-eval-report.js";

vi.mock("../full-site-eval.js", () => ({
  runFullSiteEval: vi.fn(),
}));

vi.mock("../../../src/services/eval/site-eval-persistence.js", () => ({
  recordSiteEval: vi.fn(),
}));

import { runFullSiteEval } from "../full-site-eval.js";
import { recordSiteEval } from "../../../src/services/eval/site-eval-persistence.js";

function makeContext(): StageContext {
  return {
    db: {} as StageContext["db"],
    config: {} as StageContext["config"],
    s3Client: {} as StageContext["s3Client"],
    siteUuid: "site-1",
    workspaceUuid: "ws-1",
    rendererDir: "/tmp/renderer",
    verbose: false,
    log: vi.fn(),
    tier: "paid",
    templateTheme: "baseline",
  };
}

function makeReport(totalPages: number, failedPages: number): SiteEvalReport {
  const pages = Array.from({ length: totalPages }, (_, i) => {
    const path = i === 0 ? "/" : `/page-${i}`;
    const passing = i >= failedPages;
    return {
      overall: {
        score: passing ? 92 : 55,
        grade: passing ? "A-" : "F",
        status: passing ? "passed" : "failed",
        summary: "",
        clientSummary: "",
        actionItems: [],
      },
      categories: passing
        ? []
        : [{ name: "content", score: 55, grade: "F", status: "failed", issues: [{ severity: "major", category: "content", message: "Thin content" }] }],
      metadata: { url: `https://example.com${path}`, path, title: `Page ${i}`, h1: null, wordCount: 0, loadTimeMs: 0 },
    };
  });
  return {
    evaluatedAt: new Date().toISOString(),
    pages,
    summaries: pages.map((p) => ({
      path: p.metadata.path,
      score: p.overall.score,
      grade: p.overall.grade,
      status: p.overall.status,
      title: p.metadata.title,
      totalIssues: p.categories.flatMap((c) => c.issues).length,
      criticalIssues: 0,
    })),
    summary: {
      totalPages,
      passedPages: totalPages - failedPages,
      failedPages,
      avgScore: Math.round(pages.reduce((a, b) => a + b.overall.score, 0) / totalPages),
      minScore: Math.min(...pages.map((p) => p.overall.score)),
      maxScore: Math.max(...pages.map((p) => p.overall.score)),
      worstPath: pages.find((p) => p.overall.score === Math.min(...pages.map((pp) => pp.overall.score)))?.metadata.path ?? "",
      totalIssues: failedPages,
      criticalIssues: 0,
    },
  };
}

describe("evalStage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("passes when every page passes QA", async () => {
    const report = makeReport(4, 0);
    vi.mocked(runFullSiteEval).mockResolvedValue({ pages: report.pages, report });
    vi.mocked(recordSiteEval).mockResolvedValue("eval-1");

    const result = await evalStage.run(makeContext());

    expect(result.status).toBe("pass");
    expect(result.metrics.pages).toBe(4);
    expect(result.metrics.passedPages).toBe(4);
    expect(result.metrics.failedPages).toBe(0);
    expect(recordSiteEval).toHaveBeenCalledWith(
      expect.anything(),
      "site-1",
      "ws-1",
      report,
      "pass",
    );
  });

  test("fails when any page fails QA", async () => {
    const report = makeReport(4, 2);
    vi.mocked(runFullSiteEval).mockResolvedValue({ pages: report.pages, report });
    vi.mocked(recordSiteEval).mockResolvedValue("eval-2");

    const result = await evalStage.run(makeContext());

    expect(result.status).toBe("fail");
    expect(result.metrics.pages).toBe(4);
    expect(result.metrics.passedPages).toBe(2);
    expect(result.metrics.failedPages).toBe(2);
    expect(recordSiteEval).toHaveBeenCalledWith(
      expect.anything(),
      "site-1",
      "ws-1",
      report,
      "fail",
    );
  });

  test("returns fail result on unexpected error", async () => {
    vi.mocked(runFullSiteEval).mockRejectedValue(new Error("dist not found"));

    const result = await evalStage.run(makeContext());

    expect(result.status).toBe("fail");
    expect(result.error).toContain("dist not found");
  });
});
