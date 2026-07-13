// apps/api/src/worker/workers/eval-fix.ts
// Heal a page based on a per-page QA report, then rebuild and publish using the
// registry-driven template path. This delegates to the shared eval-fix loop so
// the API and CLI stay on the same build path.

import path from "node:path";
import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";
import { runEvalFixLoop } from "../../services/eval/run-eval-fix-loop.js";
import { deployTemplateDist } from "../../services/template/deploy-template.js";
import { publishLatestStagingToProduction } from "../../services/site-versions.js";
import { promoteDeploy } from "../../services/mirror/deploy.js";
import { getS3Client } from "../../s3";

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
    const report = rawReport
      ? (typeof rawReport === "string" ? (JSON.parse(rawReport) as import("../../services/eval/page-eval-report.js").PageEvalReport) : (rawReport as unknown as import("../../services/eval/page-eval-report.js").PageEvalReport))
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

    // 2. Resolve page path from hierarchy.
    const hierarchy = await (await import("../../utils/site-hierarchy-io.js")).loadSiteHierarchyDoc(db, workspaceUuid, siteUuid);
    if (!hierarchy) {
      throw new Error(`Site hierarchy not found: ${siteUuid}`);
    }

    const resolvedPageSlug =
      hierarchy.pages.find((p) => p.slug === pageSlug)?.slug ??
      hierarchy.pages.find((p) => p.path === report.metadata.path)?.slug ??
      hierarchy.pages.find((p) => (p.path ?? p.slug) === (pageSlug === "index" ? "/" : pageSlug))?.slug ??
      pageSlug;

    const resolvedPath = report.metadata.path ?? (pageSlug === "index" ? "/" : `/${pageSlug.replace(/-/g, "/")}`);

    const s3Client = getS3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
      sessionToken: config.S3_SESSION_TOKEN,
    });
    const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
    const rendererDir = path.resolve(__dirname, "../../../../renderer");

    // 3. Run the shared heal/build/eval loop.
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
      maxLoops: remainingAttempts,
      log: (msg) => fastify.log.info({ siteUuid, evalUuid, path: resolvedPath }, msg),
    });

    if (!loopResult.changed) {
      fastify.log.info(
        { jobId: job.id, siteUuid, resolvedPageSlug },
        "eval-fix no deterministic heals applied",
      );
      return {
        fixed: false,
        pageSlug: resolvedPageSlug,
        appliedHeals: 0,
        sectionInstructions: loopResult.sectionInstructions,
        published: false,
        reEvalStatus: loopResult.report.overall.status,
        reEvalScore: loopResult.report.overall.score,
        reEvalGrade: loopResult.report.overall.grade,
      };
    }

    // 4. Publish the converged dist.
    const distDir = path.join(rendererDir, "dist");
    const deployResult = await deployTemplateDist({
      db,
      s3Client,
      bucket,
      siteUuid,
      workspaceUuid,
      distDir,
      label: "Eval-fix worker build",
      log: {
        info: (o, m) => fastify.log.info(o, m),
        warn: (o, m) => fastify.log.warn(o, m),
      },
    });

    fastify.log.info(
      { jobId: job.id, siteUuid, version: deployResult.version, deployPrefix: deployResult.deployPrefix },
      "eval-fix template deployed",
    );

    // TODO: when runEvalFixLoop exits without meeting the score threshold + 0
    // criticals, add a site flag (e.g. `sites.hiddenFromCustomer = true`) so the
    // published build is visible to us for cleanup but not surfaced to the gym.
    await promoteDeploy(s3Client, bucket, siteUuid, deployResult.deployPrefix);

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

    return {
      fixed: true,
      pageSlug: resolvedPageSlug,
      appliedHeals: loopResult.appliedHeals,
      sectionInstructions: loopResult.sectionInstructions,
      published: true,
      templateVersion: deployResult.version,
      publishedVersion: publishResult.version,
      reEvalStatus: loopResult.report.overall.status,
      reEvalScore: loopResult.report.overall.score,
      reEvalGrade: loopResult.report.overall.grade,
    };
  };
}

export default evalFixProcessor;
