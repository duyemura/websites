// apps/api/src/services/eval/run-site-eval.ts
// New per-page QA stage used by the background site_eval worker.
// Evaluates a single Milo page on its own merits: accessibility, SEO, links,
// interactivity, performance, content, and visual quality.

import type { StageRunner, StageContext, StageResult } from "./stage-types.js";
import { evaluatePage } from "./page-evaluator.js";

export const evalStage: StageRunner = {
  label: "eval",
  requires: [],
  produces: "",

  async run(ctx: StageContext): Promise<StageResult> {
    const result = await evaluatePage({
      db: ctx.db,
      config: ctx.config,
      s3Client: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      path: ctx.pageFilter?.[0] ?? "/",
      log: ctx.log,
    });

    const totalIssues = result.categories.flatMap((c) => c.issues).length;
    const criticalIssues = result.categories
      .flatMap((c) => c.issues)
      .filter((i) => i.severity === "critical").length;

    return {
      stage: "eval",
      status: result.overall.status === "passed" ? "pass" : "fail",
      durationMs: 0,
      metrics: {
        overallScore: result.overall.score,
        overallGrade: result.overall.grade,
        issues: totalIssues,
        criticalIssues,
        loadTimeMs: result.metadata.loadTimeMs,
      },
      warnings: [result.overall.summary, ...result.categories.flatMap((c) => c.issues.map((i) => `[${c.name}] ${i.severity}: ${i.message}`))],
    };
  },
};
