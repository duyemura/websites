// apps/api/scripts/stages/publish.ts
import type { StageRunner, StageContext, StageResult } from "./types";
import { publishLatestStagingToProduction } from "../../src/services/site-versions";
import { getS3Client } from "../../src/s3";
import { getTemplateSpec } from "@milo/shared-types";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { validateContentPlaceholders } from "../../src/services/template/placeholder-validator.js";

export const publishStage: StageRunner = {
  label: "publish",
  requires: [],
  produces: "",
  async run(ctx: StageContext): Promise<StageResult> {
    const theme = ctx.templateTheme ?? "beanburito";
    const spec = getTemplateSpec(theme);
    const generateArtifact = await loadArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "generate" as unknown as Parameters<typeof loadArtifact>[2],
    );
    if (spec && generateArtifact?.payload) {
      const report = validateContentPlaceholders(
        generateArtifact.payload as Record<string, unknown>,
        spec,
      );
      if (report.blocking) {
        const lines = report.issues
          .filter((i) => i.severity === "error")
          .map((i) => `  - ${i.pageKey}: ${i.field} — ${i.message}`);
        return {
          stage: "publish",
          status: "fail",
          durationMs: 0,
          metrics: { blockingIssues: lines.length },
          warnings: [],
          error: `Publish blocked by unfilled required placeholders:\n${lines.join("\n")}`,
        };
      }
    }

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
      ctx.config,
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
