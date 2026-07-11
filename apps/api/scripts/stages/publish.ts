// apps/api/scripts/stages/publish.ts
import type { StageRunner, StageContext, StageResult } from "./types";
import { publishLatestStagingToProduction } from "../../src/services/site-versions";
import { getS3Client } from "../../src/s3";

export const publishStage: StageRunner = {
  label: "publish",
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

    ctx.log(`  Copying staging/ → production/ for site ${ctx.siteUuid} …`);
    const result = await publishLatestStagingToProduction(
      ctx.db, s3Client, bucket, ctx.siteUuid,
      ctx.config.CLOUDFRONT_DISTRIBUTION_ID,
      ctx.config.CLOUDFRONT_KVS_ARN,
      ctx.config.MILO_PREVIEW_DOMAIN,
    );

    const previewDomain = ctx.config.MILO_PREVIEW_DOMAIN;
    const shortId = ctx.siteUuid.slice(0, 8);
    const urls = previewDomain
      ? {
          staging: `https://${shortId}-preview.${previewDomain}/`,
          production: `https://${shortId}.${previewDomain}/`,
        }
      : null;

    if (urls) {
      ctx.log(`  Staging:    ${urls.staging}`);
      ctx.log(`  Production: ${urls.production}`);
    }

    return {
      stage: "publish",
      status: "pass",
      durationMs: 0,
      metrics: {
        version: result.version,
        publishedAt: new Date().toISOString(),
      },
      warnings: [],
    };
  },
};
