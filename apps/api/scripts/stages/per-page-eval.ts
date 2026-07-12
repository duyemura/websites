// apps/api/scripts/stages/per-page-eval.ts
// CLI runner for the standalone per-page QA evaluator.

import { evaluatePage } from "../../src/services/eval/page-evaluator.js";
import type { StageRunner, StageContext, StageResult } from "./types";

export interface PerPageEvalOptions {
  path?: string;
  url?: string;
  keywords?: string[];
}

function resolveEvalUrl(
  siteUuid: string,
  path: string,
  explicitUrl: string | undefined,
  previewDomain: string | undefined,
): string | undefined {
  if (explicitUrl) return explicitUrl;
  if (previewDomain) {
    const shortId = siteUuid.slice(0, 8);
    const origin = `https://${shortId}-preview.${previewDomain}`;
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${origin}${normalizedPath}`;
  }
  return undefined;
}

export function perPageEvalStage(options: PerPageEvalOptions = {}): StageRunner {
  return {
    label: "Per-page QA eval",
    requires: [],
    produces: "",
    run: async (ctx: StageContext): Promise<StageResult> => {
      const start = Date.now();
      const path = options.path ?? "/";
      const url = resolveEvalUrl(ctx.siteUuid, path, options.url, ctx.config.MILO_PREVIEW_DOMAIN);
      if (!url) {
        throw new Error("Could not resolve page URL — provide --url or configure MILO_PREVIEW_DOMAIN");
      }
      ctx.log(`Evaluating ${url}`);
      const report = await evaluatePage({
        db: ctx.db,
        config: ctx.config,
        s3Client: ctx.s3Client,
        siteUuid: ctx.siteUuid,
        workspaceUuid: ctx.workspaceUuid,
        path,
        url,
        keywords: options.keywords,
        log: (msg) => ctx.log(msg),
      });

      const totalIssues = report.categories.flatMap((c) => c.issues).length;
      const criticalIssues = report.categories.flatMap((c) => c.issues).filter((i) => i.severity === "critical").length;
      const failedCategories = report.categories.filter((c) => c.status === "failed").map((c) => c.name);

      const status = report.overall.status === "passed" ? "pass" : "fail";
      const warnings = report.categories.flatMap((c) =>
        c.issues.map((i) => `[${c.name}] ${i.severity}: ${i.message}`),
      );

      if (ctx.verbose) {
        ctx.log(`Report: ${JSON.stringify(report, null, 2)}`);
      } else {
        ctx.log(`Score: ${report.overall.score}/100 (${report.overall.grade})`);
        ctx.log(`Issues: ${totalIssues} total, ${criticalIssues} critical`);
        if (failedCategories.length > 0) {
          ctx.log(`Failed categories: ${failedCategories.join(", ")}`);
        }
      }

      return {
        stage: "eval",
        status,
        durationMs: Date.now() - start,
        metrics: {
          score: report.overall.score,
          grade: report.overall.grade,
          totalIssues,
          criticalIssues,
          failedCategories: failedCategories.length,
        },
        warnings,
      };
    },
  };
}

export default perPageEvalStage;
