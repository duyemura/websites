// apps/api/scripts/stages/template.ts
import path from "node:path";
import { deployTemplate } from "../../src/services/template/deploy-template";
import { publishSiteVersion } from "../../src/services/site-versions";
import type { StageRunner, StageContext, StageResult } from "./types";

export const templateStage: StageRunner = {
  label: "template",
  // docgen docs are loaded from DB internally by buildGymJson — no artifact prereq
  requires: [],
  // site_versions table tracks the version; no pipeline artifact key
  produces: "",

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();

    const site = await ctx.db
      .selectFrom("sites")
      .select(["uuid", "workspaceUuid", "customDomain"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;

    const siteUrl = site.customDomain
      ? `https://${site.customDomain}`
      : `${ctx.config.CDN_BASE_URL}/sites/${site.uuid}/current`;

    ctx.log(`  Deploying template for site ${ctx.siteUuid}...`);

    const result = await deployTemplate({
      db: ctx.db,
      s3Client: ctx.s3Client,
      bucket,
      siteUuid: site.uuid,
      workspaceUuid: site.workspaceUuid,
      apiBaseUrl: ctx.config.CDN_BASE_URL,
      siteUrl,
      rendererDir: ctx.rendererDir,
      log: {
        info: (o, m) => ctx.log(`  [info] ${m}`),
        warn: (o, m) => ctx.log(`  [warn] ${m}`),
      },
    });

    ctx.log(`  Version ${result.version} @ ${result.deployPrefix} — ${result.routes} routes, ${result.redirects.length} redirects`);

    await publishSiteVersion(ctx.db, ctx.s3Client, bucket, ctx.siteUuid, result.version);
    ctx.log(`  Published version ${result.version} to current/`);

    return {
      stage: "template",
      status: "pass",
      durationMs: Date.now() - start,
      metrics: {
        version: result.version,
        routes: result.routes,
        redirects: result.redirects.length,
      },
      warnings: [],
    };
  },
};
