// apps/api/scripts/stages/eval-fix.ts
// CLI runner that heals a page from a per-page QA report, rebuilds the registry
// template, publishes it, and re-evaluates the live page. This keeps the entire
// fix loop on the registry-driven Tier 2 path.

import type { GymSiteContent } from "@ploy-gyms/shared-types";
import { buildFixPlan } from "../../src/services/eval/eval-fix.js";
import { evaluatePage } from "../../src/services/eval/page-evaluator.js";
import type { PageEvalReport } from "../../src/services/eval/page-eval-report.js";
import { loadSiteHierarchyDoc, saveSiteHierarchyDoc } from "../../src/utils/site-hierarchy-io.js";
import { loadDesignSystemDoc, saveDesignSystemDoc } from "../../src/utils/design-system-io.js";
import { buildGymJson } from "../../src/services/template/content-mapper.js";
import { saveArtifact, loadArtifact } from "../../src/utils/pipeline/artifact-store.js";
import { templateStage } from "./template.js";
import { publishStage } from "./publish.js";
import type { StageRunner, StageContext, StageResult } from "./types";

export interface EvalFixOptions {
  /** Existing eval uuid to base fixes on. Either this or path must be provided. */
  evalUuid?: string;
  /** Path to evaluate and fix (e.g. "/" or "/about"). Ignored when evalUuid is provided. */
  path?: string;
  url?: string;
  keywords?: string[];
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

function resolveProductionUrl(
  site: { uuid: string; customDomain: string | null },
  config: StageContext["config"],
): string | undefined {
  if (site.customDomain) return `https://${site.customDomain}`;
  if (config.MILO_PREVIEW_DOMAIN) {
    return `https://${site.uuid.slice(0, 8)}.${config.MILO_PREVIEW_DOMAIN}`;
  }
  return undefined;
}

export function evalFixStage(options: EvalFixOptions = {}): StageRunner {
  return {
    label: "Eval fix + rebuild + publish",
    requires: [],
    produces: "",
    run: async (ctx: StageContext): Promise<StageResult> => {
      const start = Date.now();
      const { db, config, siteUuid, workspaceUuid, s3Client } = ctx;

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

      const site = await db
        .selectFrom("sites")
        .select(["uuid", "workspaceUuid", "customDomain"])
        .where("uuid", "=", siteUuid)
        .executeTakeFirstOrThrow();

      const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
      if (!hierarchy) {
        throw new Error(`Site hierarchy not found for ${siteUuid}`);
      }

      const designSystemDoc = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
      if (!designSystemDoc || designSystemDoc.version !== "2") {
        throw new Error(`Design system v2 not found for ${siteUuid}`);
      }

      // Prefer the generate artifact (LLM-produced GymSiteContent) so fixes apply
      // to the same content the template stage renders. Fall back to the content
      // mapper only when the artifact is missing.
      let content: GymSiteContent | undefined;
      const generateArtifact = await loadArtifact<GymSiteContent>(
        db,
        { siteUuid, workspaceUuid },
        "generate" as unknown as Parameters<typeof loadArtifact>[2],
      );
      if (generateArtifact?.payload) {
        content = generateArtifact.payload;
      } else {
        try {
          const { content: mapped } = await buildGymJson(
            db,
            siteUuid,
            { apiBaseUrl: "", siteUrl: "", workspaceUuid },
            workspaceUuid,
          );
          content = mapped;
        } catch {
          // Tier 1 clone-only sites may not have mappable GymSiteContent.
        }
      }

      const pageSlug = pathToSlug(resolvedPath);
      const resolvedPageSlug =
        hierarchy.pages.find((p) => p.slug === pageSlug)?.slug ??
        hierarchy.pages.find((p) => p.path === resolvedPath)?.slug ??
        pageSlug;

      const plan = buildFixPlan({
        report,
        content,
        hierarchy,
        designSystem: designSystemDoc,
        pageSlug: resolvedPageSlug,
      });

      if (!plan.changed) {
        return {
          stage: "eval-fix",
          status: "fail",
          durationMs: Date.now() - start,
          metrics: {
            score: report.overall.score,
            grade: report.overall.grade,
            appliedHeals: 0,
            sectionInstructions: plan.brief.sectionInstructions.length,
          },
          warnings: plan.brief.sectionInstructions.map((s) => `[${s.sectionId}] ${s.instructions}`),
          error: "No deterministic heals could be applied; remaining issues need visual/interactivity edits.",
        };
      }

      await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, plan.hierarchy);
      await saveDesignSystemDoc(db, workspaceUuid, siteUuid, plan.designSystem);

      // Save the healed content back so the template stage uses it instead of the
      // older generate artifact or content-mapper defaults.
      if (plan.content) {
        await saveArtifact(
          db,
          { siteUuid, workspaceUuid },
          "generate" as unknown as Parameters<typeof saveArtifact>[2],
          plan.content,
        );
      }

      ctx.log("  Rebuilding template from healed docs...");
      const templateResult = await templateStage.run(ctx);
      if (templateResult.status === "fail") {
        return {
          stage: "eval-fix",
          status: "fail",
          durationMs: Date.now() - start,
          metrics: {
            score: report.overall.score,
            grade: report.overall.grade,
            appliedHeals: plan.brief.appliedHeals.length,
            sectionInstructions: plan.brief.sectionInstructions.length,
          },
          warnings: plan.brief.appliedHeals.map((h) => `[${h.category}] ${h.target}: ${h.message}`),
          error: `Template rebuild failed: ${templateResult.error ?? "unknown error"}`,
        };
      }

      ctx.log("  Publishing updated build...");
      const publishResult = await publishStage.run(ctx);
      if (publishResult.status === "fail") {
        return {
          stage: "eval-fix",
          status: "fail",
          durationMs: Date.now() - start,
          metrics: {
            score: report.overall.score,
            grade: report.overall.grade,
            appliedHeals: plan.brief.appliedHeals.length,
            sectionInstructions: plan.brief.sectionInstructions.length,
            templateVersion: templateResult.metrics.version,
          },
          warnings: plan.brief.appliedHeals.map((h) => `[${h.category}] ${h.target}: ${h.message}`),
          error: `Publish failed: ${publishResult.error ?? "unknown error"}`,
        };
      }

      const productionUrl = resolveProductionUrl(site, config);
      if (!productionUrl) {
        throw new Error("Could not resolve production URL — configure MILO_PREVIEW_DOMAIN or set a custom domain");
      }
      const reEvalUrl = `${productionUrl}${resolvedPath}`;
      ctx.log(`  Re-evaluating ${reEvalUrl}`);
      const reEvalReport = await evaluatePage({
        db,
        config,
        s3Client,
        siteUuid,
        workspaceUuid,
        path: resolvedPath,
        url: reEvalUrl,
        keywords: options.keywords,
        log: (msg) => ctx.log(msg),
      });

      const totalIssues = reEvalReport.categories.flatMap((c) => c.issues).length;
      const criticalIssues = reEvalReport.categories
        .flatMap((c) => c.issues)
        .filter((i) => i.severity === "critical").length;
      const failedCategories = reEvalReport.categories
        .filter((c) => c.status === "failed")
        .map((c) => c.name);
      const reEvalStatus = reEvalReport.overall.status === "passed" ? "pass" : "fail";

      return {
        stage: "eval-fix",
        status: reEvalStatus,
        durationMs: Date.now() - start,
        metrics: {
          score: reEvalReport.overall.score,
          grade: reEvalReport.overall.grade,
          totalIssues,
          criticalIssues,
          failedCategories: failedCategories.length,
          appliedHeals: plan.brief.appliedHeals.length,
          sectionInstructions: plan.brief.sectionInstructions.length,
          templateVersion: templateResult.metrics.version,
          publishedVersion: publishResult.metrics.version,
        },
        warnings: [
          ...plan.brief.appliedHeals.map((h) => `[${h.category}] ${h.target}: ${h.message}`),
          ...reEvalReport.categories.flatMap((c) =>
            c.issues.map((i) => `[${c.name}] ${i.severity}: ${i.message}`),
          ),
        ],
      };
    },
  };
}

export default evalFixStage;
