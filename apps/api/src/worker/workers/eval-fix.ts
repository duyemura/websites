// apps/api/src/worker/workers/eval-fix.ts
// Heal a page based on a per-page QA report, then rebuild and publish using the
// registry-driven template path. This mirrors the CLI eval-fix stage so the API
// and CLI stay on the same build path.

import path from "node:path";
import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { GymSiteContent } from "@ploy-gyms/shared-types";
import type { QueueConfig } from "../../bullmq";
import { buildFixPlan } from "../../services/eval/eval-fix.js";
import { evaluatePage } from "../../services/eval/page-evaluator.js";
import type { PageEvalReport } from "../../services/eval/page-eval-report.js";
import { loadSiteHierarchyDoc, saveSiteHierarchyDoc } from "../../utils/site-hierarchy-io.js";
import { loadDesignSystemDoc, saveDesignSystemDoc } from "../../utils/design-system-io.js";
import { buildGymJson } from "../../services/template/content-mapper.js";
import { deployTemplate } from "../../services/template/deploy-template.js";
import { publishLatestStagingToProduction } from "../../services/site-versions.js";
import { saveArtifact, loadArtifact } from "../../utils/pipeline/artifact-store.js";
import { getS3Client } from "../../s3";

function resolveProductionUrl(
  site: { uuid: string; customDomain: string | null },
  config: FastifyInstance["config"],
): string | undefined {
  if (site.customDomain) return `https://${site.customDomain}`;
  if (config.MILO_PREVIEW_DOMAIN) {
    return `https://${site.uuid.slice(0, 8)}.${config.MILO_PREVIEW_DOMAIN}`;
  }
  return undefined;
}

export function evalFixProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["eval_fix"]["data"]>): Promise<QueueConfig["eval_fix"]["result"]> => {
    const { siteUuid, workspaceUuid, evalUuid, pageSlug, remainingAttempts = 1 } = job.data;
    fastify.log.info({ jobId: job.id, siteUuid, evalUuid, pageSlug, remainingAttempts }, "eval-fix worker started");

    const { db, config } = fastify;

    // 1. Load the evaluator report.
    const evalRow = await db
      .selectFrom("siteEvals")
      .select(["report", "status"])
      .where("uuid", "=", evalUuid)
      .executeTakeFirst();

    if (!evalRow) {
      throw new Error(`Site eval record not found: ${evalUuid}`);
    }

    const rawReport = evalRow.report;
    const report: PageEvalReport | null = rawReport
      ? (typeof rawReport === "string" ? (JSON.parse(rawReport) as PageEvalReport) : (rawReport as unknown as PageEvalReport))
      : null;

    if (!report) {
      throw new Error(`Site eval ${evalUuid} has no report to act on`);
    }

    if (report.overall.status === "passed") {
      return {
        fixed: false,
        pageSlug,
        appliedHeals: 0,
        sectionInstructions: 0,
        published: false,
        reEvalStatus: "passed",
      };
    }

    // 2. Load current site docs.
    const site = await db
      .selectFrom("sites")
      .select(["uuid", "workspaceUuid", "customDomain"])
      .where("uuid", "=", siteUuid)
      .executeTakeFirst();

    if (!site) {
      throw new Error(`Site not found: ${siteUuid}`);
    }

    const hierarchy = await loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
    if (!hierarchy) {
      throw new Error(`Site hierarchy not found: ${siteUuid}`);
    }

    const resolvedPageSlug =
      hierarchy.pages.find((p) => p.slug === pageSlug)?.slug ??
      hierarchy.pages.find((p) => p.path === report.metadata.path)?.slug ??
      hierarchy.pages.find((p) => (p.path ?? p.slug) === (pageSlug === "index" ? "/" : pageSlug))?.slug ??
      pageSlug;

    const designSystemDoc = await loadDesignSystemDoc(db, workspaceUuid, siteUuid);
    if (!designSystemDoc || designSystemDoc.version !== "2") {
      throw new Error(`Design system v2 not found for site ${siteUuid}`);
    }

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

    // 3. Build and apply the fix plan.
    const plan = buildFixPlan({
      report,
      content,
      hierarchy,
      designSystem: designSystemDoc,
      pageSlug: resolvedPageSlug,
    });

    if (!plan.changed) {
      fastify.log.info(
        { jobId: job.id, siteUuid, resolvedPageSlug },
        "eval-fix no deterministic heals applied",
      );
      return {
        fixed: false,
        pageSlug: resolvedPageSlug,
        appliedHeals: 0,
        sectionInstructions: plan.brief.sectionInstructions.length,
        published: false,
        reEvalStatus: report.overall.status,
      };
    }

    await saveSiteHierarchyDoc(db, workspaceUuid, siteUuid, plan.hierarchy);
    await saveDesignSystemDoc(db, workspaceUuid, siteUuid, plan.designSystem);

    if (plan.content) {
      await saveArtifact(
        db,
        { siteUuid, workspaceUuid },
        "generate" as unknown as Parameters<typeof saveArtifact>[2],
        plan.content,
      );
    }

    fastify.log.info(
      { jobId: job.id, siteUuid, resolvedPageSlug, appliedHeals: plan.brief.appliedHeals.length, sectionInstructions: plan.brief.sectionInstructions.length },
      "eval-fix saved healed docs",
    );

    // 4. Rebuild and publish using the registry-driven template path.
    const s3Client = getS3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
      sessionToken: config.S3_SESSION_TOKEN,
    });
    const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
    const rendererDir = path.resolve(__dirname, "../../../../renderer");
    const siteUrl = site.customDomain
      ? `https://${site.customDomain}`
      : `${config.CDN_BASE_URL}/sites/${siteUuid}`;

    const deployResult = await deployTemplate({
      db,
      s3Client,
      bucket,
      siteUuid,
      workspaceUuid,
      rendererDir,
      apiBaseUrl: config.CDN_BASE_URL,
      siteUrl,
      log: {
        info: (o, m) => fastify.log.info(o, m),
        warn: (o, m) => fastify.log.warn(o, m),
      },
    });

    fastify.log.info(
      { jobId: job.id, siteUuid, version: deployResult.version, deployPrefix: deployResult.deployPrefix },
      "eval-fix template deployed",
    );

    const publishResult = await publishLatestStagingToProduction(
      db,
      s3Client,
      bucket,
      siteUuid,
      config.CLOUDFRONT_DISTRIBUTION_ID,
      config.CLOUDFRONT_KVS_ARN,
      config.MILO_PREVIEW_DOMAIN,
    );

    fastify.log.info(
      { jobId: job.id, siteUuid, version: publishResult.version },
      "eval-fix published to production",
    );

    // 5. Re-evaluate the live page.
    const productionUrl = resolveProductionUrl(site, config);
    const reEvalPath = report.metadata.path ?? "/";
    const reEvalUrl = productionUrl ? `${productionUrl}${reEvalPath}` : undefined;
    const reEvalReport = await evaluatePage({
      db,
      config,
      s3Client,
      siteUuid,
      workspaceUuid,
      path: reEvalPath,
      url: reEvalUrl,
      log: (msg) => fastify.log.info({ siteUuid, evalUuid, path: reEvalPath }, msg),
    });

    const reEvalStatus = reEvalReport.overall.status;

    fastify.log.info(
      { jobId: job.id, siteUuid, score: reEvalReport.overall.score, grade: reEvalReport.overall.grade, status: reEvalStatus },
      "eval-fix re-evaluation complete",
    );

    return {
      fixed: true,
      pageSlug: resolvedPageSlug,
      appliedHeals: plan.brief.appliedHeals.length,
      sectionInstructions: plan.brief.sectionInstructions.length,
      published: true,
      templateVersion: deployResult.version,
      publishedVersion: publishResult.version,
      reEvalStatus,
      reEvalScore: reEvalReport.overall.score,
      reEvalGrade: reEvalReport.overall.grade,
    };
  };
}

export default evalFixProcessor;
