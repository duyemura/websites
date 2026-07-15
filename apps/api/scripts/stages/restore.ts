// apps/api/scripts/stages/restore.ts
import type { StageRunner, StageContext, StageResult } from "./types";
import { publishSiteVersion, listSiteVersions } from "../../src/services/site-versions";
import { getS3Client } from "../../src/s3";

export const restoreStage: StageRunner = {
  label: "restore",
  requires: [],
  produces: "",
  async run(ctx: StageContext): Promise<StageResult> {
    const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;
    const s3Client = getS3Client({
      endpoint: ctx.config.S3_ENDPOINT,
      region: ctx.config.S3_REGION,
      accessKeyId: ctx.config.S3_ACCESS_KEY,
      secretAccessKey: ctx.config.S3_SECRET_KEY,
    });

    // Read --version from process.argv
    const versionArgIdx = process.argv.indexOf("--version");
    const versionArg = versionArgIdx >= 0 ? Number(process.argv[versionArgIdx + 1]) : NaN;

    if (isNaN(versionArg) || versionArg <= 0) {
      // No version specified — list available versions and exit
      const versions = await listSiteVersions(ctx.db, ctx.siteUuid);
      if (versions.length === 0) {
        return { stage: "restore", status: "fail", durationMs: 0, metrics: {}, warnings: [],
          error: "No versions found for this site. Mirror the site first." };
      }
      ctx.log("\nAvailable versions:");
      for (const v of versions) {
        const published = v.publishedAt ? ` ← published ${new Date(v.publishedAt).toISOString()}` : "";
        ctx.log(`  v${v.version}  ${v.kind}  ${v.label ?? v.deployPrefix}${published}`);
      }
      ctx.log("\nRun with --version <N> to restore a specific version.");
      return { stage: "restore", status: "warn", durationMs: 0,
        metrics: { availableVersions: versions.length }, warnings: ["--version not specified — listed versions above"] };
    }

    ctx.log(`  Restoring v${versionArg} → staging/ then → production/ …`);
    const result = await publishSiteVersion(
      ctx.db, s3Client, bucket, ctx.siteUuid, versionArg,
      ctx.config.CLOUDFRONT_DISTRIBUTION_ID,
      ctx.config.CLOUDFRONT_KVS_ARN,
      ctx.config.MILO_PREVIEW_DOMAIN,
      ctx.config,
    );

    return {
      stage: "restore",
      status: "pass",
      durationMs: 0,
      metrics: { restoredVersion: result.version, deployPrefix: result.deployPrefix },
      warnings: [],
    };
  },
};
