// apps/api/scripts/stages/eval-fix.ts
// Heal every generated page that fails QA. Evaluates the full local dist,
// runs the per-page heal loop for failing routes, then deploys the converged
// build to staging. Production publish requires an explicit `milo publish` call.

import path from "node:path";
import { buildSiteEvalReport, type PageEvalReport, type SiteEvalReport } from "../../src/services/eval/page-eval-report.js";
import { evaluatePage } from "../../src/services/eval/page-evaluator.js";
import { runEvalFixLoop } from "../../src/services/eval/run-eval-fix-loop.js";
import { loadSiteEval } from "../../src/services/eval/site-eval-persistence.js";
import { deployTemplateDist } from "../../src/services/template/deploy-template.js";
import { promoteDeploy } from "../../src/services/mirror/deploy.js";
import { runFullSiteEval } from "./full-site-eval.js";
import type { StageRunner, StageContext, StageResult } from "./types";

export interface EvalFixOptions {
  /** Existing eval uuid to base fixes on. If omitted, a fresh full-site eval is run. */
  evalUuid?: string;
  /** Fix a single path instead of running the full site. */
  path?: string;
  url?: string;
  keywords?: string[];
  /**
   * Minimum overall score to consider the page acceptable. Default matches the
   * evaluator's pass threshold (70).
   */
  scoreThreshold?: number;
  /** Maximum number of heal/build/eval loops per page. Default 10. */
  maxLoops?: number;
}

function pathToSlug(pagePath: string): string {
  if (!pagePath || pagePath === "/") return "index";
  return pagePath.replace(/^\//, "").replace(/\//g, "-");
}

function resolveEvalUrl(
  siteUuid: string,
  pagePath: string,
  explicitUrl: string | undefined,
  previewDomain: string | undefined,
): string | undefined {
  if (explicitUrl) return explicitUrl;
  if (previewDomain) {
    const shortId = siteUuid.slice(0, 8);
    const origin = `https://${shortId}-preview.${previewDomain}`;
    const normalizedPath = pagePath.startsWith("/") ? pagePath : `/${pagePath}`;
    return `${origin}${normalizedPath}`;
  }
  return undefined;
}

function pageFailed(report: PageEvalReport, threshold: number): boolean {
  return report.overall.status === "failed" || report.overall.score < threshold;
}

function resolvePageSlug(
  hierarchyDoc: { pages: Array<{ slug: string; path?: string }> },
  pagePath: string,
): string {
  const slug = pathToSlug(pagePath);
  return (
    hierarchyDoc.pages.find((p) => p.slug === slug)?.slug ??
    hierarchyDoc.pages.find((p) => p.path === pagePath)?.slug ??
    slug
  );
}

function aggregateWarnings(pages: PageEvalReport[]): string[] {
  return pages.flatMap((p) =>
    p.categories.flatMap((c) =>
      c.issues.map((i) => `${p.metadata.path}: [${c.name}] ${i.severity}: ${i.message}`),
    ),
  );
}

export function evalFixStage(options: EvalFixOptions = {}): StageRunner {
  return {
    label: "Full-site eval-fix loop + publish",
    requires: [],
    produces: "",
    run: async (ctx: StageContext): Promise<StageResult> => {
      const start = Date.now();
      const { db, config, siteUuid, workspaceUuid, s3Client, rendererDir } = ctx;
      const distDir = path.join(rendererDir, "dist");
      const threshold = options.scoreThreshold ?? 70;

      // 1. Gather initial per-page reports.
      let allReports: PageEvalReport[] = [];
      let source = "local dist";

      if (options.evalUuid) {
        const loaded = await loadSiteEval(db, options.evalUuid);
        if (!loaded) {
          throw new Error(`Site eval not found: ${options.evalUuid}`);
        }
        if (loaded.report?.pages) {
          allReports = loaded.report.pages;
          source = `eval ${options.evalUuid}`;
        } else if (loaded.pages.length === 1) {
          const p = loaded.pages[0]!;
          const url = resolveEvalUrl(siteUuid, p.path, undefined, config.MILO_PREVIEW_DOMAIN);
          if (!url) {
            throw new Error("Could not resolve page URL from eval record");
          }
          ctx.log(`Evaluating ${url}`);
          allReports = [
            await evaluatePage({
              db,
              config,
              s3Client,
              siteUuid,
              workspaceUuid,
              path: p.path,
              url,
              keywords: options.keywords,
              log: (msg) => ctx.log(msg),
            }),
          ];
        } else {
          throw new Error(`Site eval ${options.evalUuid} has no report or pages to act on`);
        }
      } else if (options.path || options.url) {
        const pagePath = options.path ?? "/";
        const url = resolveEvalUrl(siteUuid, pagePath, options.url, config.MILO_PREVIEW_DOMAIN);
        if (!url) {
          throw new Error("Could not resolve page URL — provide --url or configure MILO_PREVIEW_DOMAIN");
        }
        ctx.log(`Evaluating ${url}`);
        allReports = [
          await evaluatePage({
            db,
            config,
            s3Client,
            siteUuid,
            workspaceUuid,
            path: pagePath,
            url,
            keywords: options.keywords,
            log: (msg) => ctx.log(msg),
          }),
        ];
      } else {
        ctx.log("Running full-site eval to identify failing pages...");
        const { pages } = await runFullSiteEval(ctx, distDir, { concurrency: 3, keywords: options.keywords });
        allReports = pages;
      }

      const initialReport = buildSiteEvalReport(allReports);
      ctx.log(
        `Initial QA: ${initialReport.summary.totalPages} pages, ${initialReport.summary.passedPages} passed, ${initialReport.summary.failedPages} failed`,
      );

      // 2. Determine failing pages.
      let failingPages = allReports.filter((r) => pageFailed(r, threshold));
      if (failingPages.length === 0) {
        return {
          stage: "eval-fix",
          status: "pass",
          durationMs: Date.now() - start,
          metrics: {
            pages: initialReport.summary.totalPages,
            passedPages: initialReport.summary.passedPages,
            failedPages: 0,
            avgScore: initialReport.summary.avgScore,
            minScore: initialReport.summary.minScore,
            source,
          },
          warnings: aggregateWarnings(allReports),
        };
      }

      ctx.log(`Healing ${failingPages.length} failing page${failingPages.length === 1 ? "" : "s"}...`);

      // 3. Load hierarchy once for slug resolution.
      const { loadSiteHierarchyDoc } = await import("../../src/utils/site-hierarchy-io.js");
      const hierarchyDoc = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
      if (!hierarchyDoc) {
        throw new Error(`Site hierarchy not found for ${siteUuid}`);
      }

      // 4. Run per-page heal loops.
      let totalLoops = 0;
      let totalAppliedHeals = 0;
      let totalSectionInstructions = 0;
      let anyChanged = false;

      for (const report of failingPages) {
        const pagePath = report.metadata.path;
        const resolvedPageSlug = resolvePageSlug(hierarchyDoc, pagePath);

        ctx.log(`\n  [${pagePath}] score ${report.overall.score}${report.overall.grade} — starting heal loop`);
        const loopResult = await runEvalFixLoop({
          db,
          config,
          s3Client,
          siteUuid,
          workspaceUuid,
          rendererDir,
          report,
          resolvedPath: pagePath,
          resolvedPageSlug,
          scoreThreshold: threshold,
          maxLoops: options.maxLoops,
          keywords: options.keywords,
          templateTheme: ctx.templateTheme,
          log: (msg) => ctx.log(`  [${pagePath}] ${msg}`),
        });

        totalLoops += loopResult.loops;
        totalAppliedHeals += loopResult.appliedHeals;
        totalSectionInstructions += loopResult.sectionInstructions;
        if (loopResult.changed) {
          anyChanged = true;
          // Update the stored report for this page so the final aggregate is accurate.
          const idx = allReports.findIndex((r) => r.metadata.path === pagePath);
          if (idx >= 0) {
            allReports[idx] = loopResult.report;
          }
        }
      }

      // 5. Re-evaluate the converged dist to get final per-page grades.
      let finalReport: SiteEvalReport;
      if (anyChanged) {
        ctx.log("\n  Running final full-site eval on converged build...");
        const { report } = await runFullSiteEval(ctx, distDir, { concurrency: 3, keywords: options.keywords });
        finalReport = report;
      } else {
        finalReport = buildSiteEvalReport(allReports);
      }

      if (!anyChanged && finalReport.summary.failedPages > 0) {
        return {
          stage: "eval-fix",
          status: "fail",
          durationMs: Date.now() - start,
          metrics: {
            pages: finalReport.summary.totalPages,
            passedPages: finalReport.summary.passedPages,
            failedPages: finalReport.summary.failedPages,
            avgScore: finalReport.summary.avgScore,
            minScore: finalReport.summary.minScore,
            appliedHeals: totalAppliedHeals,
            sectionInstructions: totalSectionInstructions,
            loops: totalLoops,
          },
          warnings: aggregateWarnings(finalReport.pages),
          error: "No deterministic heals could be applied to the failing pages; remaining issues need visual/interactivity edits.",
        };
      }

      // 6. Deploy the converged build to staging. Production publish requires an
      // explicit `milo publish --site <uuid>` invocation per workspace policy.
      ctx.log(`\n  Staging converged build after ${totalLoops} loop${totalLoops === 1 ? "" : "s"}...`);
      const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
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

      return {
        stage: "eval-fix",
        status: finalReport.summary.failedPages === 0 ? "pass" : "fail",
        durationMs: Date.now() - start,
        metrics: {
          pages: finalReport.summary.totalPages,
          passedPages: finalReport.summary.passedPages,
          failedPages: finalReport.summary.failedPages,
          avgScore: finalReport.summary.avgScore,
          minScore: finalReport.summary.minScore,
          appliedHeals: totalAppliedHeals,
          sectionInstructions: totalSectionInstructions,
          loops: totalLoops,
          templateVersion: templateResult.version,
          stagedVersion: templateResult.version,
        },
        warnings: [
          ...aggregateWarnings(finalReport.pages),
          "Build staged. Run `milo publish --site <uuid>` to promote to production.",
        ],
      };
    },
  };
}

export default evalFixStage;
