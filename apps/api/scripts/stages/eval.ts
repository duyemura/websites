// apps/api/scripts/stages/eval.ts
// `milo eval` pipeline stage — evaluates every generated page in the local dist
// and persists a per-page site_evals report.
import path from "node:path";
import { runFullSiteEval } from "./full-site-eval.js";
import { recordSiteEval } from "../../src/services/eval/site-eval-persistence.js";
import type { StageRunner, StageContext, StageResult } from "./types";

export const evalStage: StageRunner = {
  label: "Full-site per-page QA eval",
  requires: [],
  produces: "",
  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();
    const distDir = path.join(ctx.rendererDir, "dist");

    try {
      const { pages, report } = await runFullSiteEval(ctx, distDir, { concurrency: 3 });

      const status = report.summary.failedPages === 0 ? "pass" : "fail";
      const warnings = pages.flatMap((p) =>
        p.categories.flatMap((c) =>
          c.issues.map((i) => `${p.metadata.path}: [${c.name}] ${i.severity}: ${i.message}`),
        ),
      );

      // Persist the full per-page report so eval-fix can load it later.
      await recordSiteEval(ctx.db, ctx.siteUuid, ctx.workspaceUuid, report, status);

      if (ctx.verbose) {
        for (const p of pages) {
          ctx.log(`  ${p.metadata.path}: ${p.overall.score}/100 ${p.overall.grade} (${p.categories.flatMap((c) => c.issues).length} issues)`);
        }
      } else {
        ctx.log(`  ${report.summary.totalPages} pages: ${report.summary.passedPages} passed, ${report.summary.failedPages} failed`);
        ctx.log(`  Average score: ${report.summary.avgScore}, worst: ${report.summary.minScore} @ ${report.summary.worstPath}`);
        if (report.summary.criticalIssues > 0) {
          ctx.log(`  ${report.summary.criticalIssues} critical issues total`);
        }
      }

      return {
        stage: "eval",
        status,
        durationMs: Date.now() - start,
        metrics: {
          pages: report.summary.totalPages,
          passedPages: report.summary.passedPages,
          failedPages: report.summary.failedPages,
          avgScore: report.summary.avgScore,
          minScore: report.summary.minScore,
          worstPath: report.summary.worstPath,
          criticalIssues: report.summary.criticalIssues,
        },
        warnings,
      };
    } catch (err) {
      return {
        stage: "eval",
        status: "fail",
        durationMs: Date.now() - start,
        metrics: {},
        warnings: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
