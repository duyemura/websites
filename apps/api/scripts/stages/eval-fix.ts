// apps/api/scripts/stages/eval-fix.ts
// CLI runner that heals a page from a per-page QA report, rebuilds the registry
// template locally until the page passes, then publishes once. This keeps the
// entire fix loop on the registry-driven Tier 2 path while avoiding S3/CloudFront
// churn per iteration.

import path from "node:path";
import type { PageEvalReport } from "../../src/services/eval/page-eval-report.js";
import { evaluatePage } from "../../src/services/eval/page-evaluator.js";
import { runEvalFixLoop } from "../../src/services/eval/run-eval-fix-loop.js";
import { deployTemplateDist } from "../../src/services/template/deploy-template.js";
import { promoteDeploy } from "../../src/services/mirror/deploy.js";
import { publishStage } from "./publish.js";
import type { StageRunner, StageContext, StageResult } from "./types";

export interface EvalFixOptions {
  /** Existing eval uuid to base fixes on. Either this or path must be provided. */
  evalUuid?: string;
  /** Path to evaluate and fix (e.g. "/" or "/about"). Ignored when evalUuid is provided. */
  path?: string;
  url?: string;
  keywords?: string[];
  /**
   * Minimum overall score to consider the page acceptable. Default matches the
   * evaluator's pass threshold (70).
   */
  scoreThreshold?: number;
  /** Maximum number of heal/build/eval loops. Default 10. */
  maxLoops?: number;
}

function pathToSlug(path: string): string {
  if (!path || path === "/") return "index";
  return path.replace(/^\//, "").replace(/\//g, "-");
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

export function evalFixStage(options: EvalFixOptions = {}): StageRunner {
  return {
    label: "Eval fix + local rebuild loop + publish",
    requires: [],
    produces: "",
    run: async (ctx: StageContext): Promise<StageResult> => {
      const start = Date.now();
      const { db, config, siteUuid, workspaceUuid, s3Client, rendererDir } = ctx;

      let report: PageEvalReport;
      let resolvedPath = options.path ?? "/";

      if (options.evalUuid) {
        const row = await db
          .selectFrom("siteEvals")
          .select(["report", "pages"])
          .where("uuid", "=", options.evalUuid)
          .executeTakeFirst();
        if (!row) {
          throw new Error(`Site eval not found: ${options.evalUuid}`);
        }
        if (!row.report) {
          throw new Error(`Site eval ${options.evalUuid} has no report`);
        }
        report = typeof row.report === "string" ? (JSON.parse(row.report) as PageEvalReport) : (row.report as unknown as PageEvalReport);
        const pages = row.pages as Array<{ path?: string }> | undefined;
        resolvedPath = report.metadata.path ?? pages?.[0]?.path ?? "/";
      } else {
        const url = resolveEvalUrl(siteUuid, resolvedPath, options.url, config.MILO_PREVIEW_DOMAIN);
        if (!url) {
          throw new Error("Could not resolve page URL — provide --url or configure MILO_PREVIEW_DOMAIN");
        }
        ctx.log(`Evaluating ${url}`);
        report = await evaluatePage({
          db,
          config,
          s3Client,
          siteUuid,
          workspaceUuid,
          path: resolvedPath,
          url,
          keywords: options.keywords,
          log: (msg) => ctx.log(msg),
        });
      }

      if (report.overall.status === "passed") {
        return {
          stage: "eval-fix",
          status: "pass",
          durationMs: Date.now() - start,
          metrics: { score: report.overall.score, grade: report.overall.grade },
          warnings: ["No issues found — nothing to fix."],
        };
      }

      const hierarchy = await db
        .selectFrom("sites")
        .selectAll()
        .where("uuid", "=", siteUuid)
        .executeTakeFirst();
      // We need the hierarchy doc to resolve the page slug; the loop loads it itself,
      // but we need to pick the right slug before calling it.
      const { loadSiteHierarchyDoc } = await import("../../src/utils/site-hierarchy-io.js");
      const hierarchyDoc = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
      if (!hierarchyDoc) {
        throw new Error(`Site hierarchy not found for ${siteUuid}`);
      }

      const pageSlug = pathToSlug(resolvedPath);
      const resolvedPageSlug =
        hierarchyDoc.pages.find((p) => p.slug === pageSlug)?.slug ??
        hierarchyDoc.pages.find((p) => p.path === resolvedPath)?.slug ??
        pageSlug;

      const loopResult = await runEvalFixLoop({
        db,
        config,
        s3Client,
        siteUuid,
        workspaceUuid,
        rendererDir,
        report,
        resolvedPath,
        resolvedPageSlug,
        scoreThreshold: options.scoreThreshold,
        maxLoops: options.maxLoops,
        keywords: options.keywords,
        templateTheme: ctx.templateTheme,
        log: (msg) => ctx.log(msg),
      });

      if (!loopResult.changed) {
        const finalMetrics = loopResult.report.categories.flatMap((c) => c.issues);
        const criticalIssues = finalMetrics.filter((i) => i.severity === "critical").length;
        return {
          stage: "eval-fix",
          status: "fail",
          durationMs: Date.now() - start,
          metrics: {
            score: loopResult.report.overall.score,
            grade: loopResult.report.overall.grade,
            appliedHeals: 0,
            sectionInstructions: loopResult.sectionInstructions,
            loops: loopResult.loops,
            totalIssues: finalMetrics.length,
            criticalIssues,
          },
          warnings: loopResult.report.categories.flatMap((c) =>
            c.issues.map((i) => `[${c.name}] ${i.severity}: ${i.message}`),
          ),
          error: loopResult.convergedReason ?? "No deterministic heals could be applied; remaining issues need visual/interactivity edits.",
        };
      }

      // TODO: when the loop exits without meeting the score threshold + 0 criticals,
      // add a site flag (e.g. `sites.hiddenFromCustomer = true`) so the published
      // build is visible to us for cleanup but not surfaced to the gym. Until then
      // we publish unconditionally so eval-fix behaves like a normal build.
      ctx.log(`\n  Publishing converged build after ${loopResult.loops} loop${loopResult.loops === 1 ? "" : "s"}...`);
      const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
      const distDir = path.join(rendererDir, "dist");
      const templateResult = await deployTemplateDist({
        db,
        s3Client,
        bucket,
        siteUuid,
        workspaceUuid,
        distDir,
        templateTheme: ctx.templateTheme,
        label: "Eval-fix converged build",
        log: {
          info: (o, m) => ctx.log(`  [deploy] ${m}`),
          warn: (o, m) => ctx.log(`  [warn] ${m}`),
        },
      });
      await promoteDeploy(s3Client, bucket, siteUuid, templateResult.deployPrefix);

      const publishResult = await publishStage.run(ctx);
      if (publishResult.status === "fail") {
        return {
          stage: "eval-fix",
          status: "fail",
          durationMs: Date.now() - start,
          metrics: {
            score: loopResult.report.overall.score,
            grade: loopResult.report.overall.grade,
            appliedHeals: loopResult.appliedHeals,
            sectionInstructions: loopResult.sectionInstructions,
            loops: loopResult.loops,
            templateVersion: templateResult.version,
          },
          warnings: loopResult.report.categories.flatMap((c) =>
            c.issues.map((i) => `[${c.name}] ${i.severity}: ${i.message}`),
          ),
          error: `Publish failed: ${publishResult.error ?? "unknown error"}`,
        };
      }

      const finalIssues = loopResult.report.categories.flatMap((c) => c.issues);
      const criticalIssues = finalIssues.filter((i) => i.severity === "critical").length;
      const reEvalStatus = loopResult.report.overall.status === "passed" ? "pass" : "fail";

      return {
        stage: "eval-fix",
        status: reEvalStatus,
        durationMs: Date.now() - start,
        metrics: {
          score: loopResult.report.overall.score,
          grade: loopResult.report.overall.grade,
          totalIssues: finalIssues.length,
          criticalIssues,
          failedCategories: loopResult.report.categories.filter((c) => c.status === "failed").length,
          appliedHeals: loopResult.appliedHeals,
          sectionInstructions: loopResult.sectionInstructions,
          loops: loopResult.loops,
          templateVersion: templateResult.version,
          publishedVersion: publishResult.metrics.version,
        },
        warnings: [
          loopResult.convergedReason ?? undefined,
          ...loopResult.report.categories.flatMap((c) =>
            c.issues.map((i) => `[${c.name}] ${i.severity}: ${i.message}`),
          ),
        ].filter(Boolean) as string[],
      };
    },
  };
}

export default evalFixStage;
