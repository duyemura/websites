// One-off: re-run asset capture + vision tagging against the latest crawl artifact.
// Does NOT re-crawl or change the live mirror — only updates the mirror-assets artifact.
import "dotenv/config";
import "./load-root-env.js";
import { db, config } from "../src/database";
import { getS3Client } from "../src/s3";
import { loadArtifact, saveArtifact } from "../src/utils/pipeline/artifact-store";
import { captureAssets } from "../src/services/mirror/capture-assets";
import type { MirrorCrawlArtifact, MirrorAssetsArtifact } from "../src/types/mirror";

async function main() {
  const siteUuid = process.argv[2];
  const workspaceUuid = process.argv[3];
  if (!siteUuid || !workspaceUuid) {
    console.error("Usage: pnpm tsx scripts/tag-existing-assets.ts <siteUuid> <workspaceUuid>");
    process.exit(1);
  }

  const ctx = { siteUuid, workspaceUuid };
  const crawl = await loadArtifact<MirrorCrawlArtifact>(db, ctx, "mirror-crawl");
  if (!crawl) throw new Error("No crawl artifact found");

  const assetsArtifact = await loadArtifact<MirrorAssetsArtifact>(db, ctx, "mirror-assets");
  const snapshotVersion = assetsArtifact?.version ?? 1;
  const snapshotPrefix = `sites/${siteUuid}/snapshots/${snapshotVersion}`;

  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  const s3Client = getS3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    bucket,
  });

  const visionConfig = config.VISION_LLM_MODEL
    ? {
        LLM_PROVIDER: config.LLM_PROVIDER ?? "openrouter",
        OPENROUTER_API_KEY: config.OPENROUTER_API_KEY,
        OPENROUTER_BASE_URL: config.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
        OLLAMA_API_KEY: config.OLLAMA_API_KEY,
        OLLAMA_BASE_URL: config.OLLAMA_BASE_URL ?? "http://localhost:11434",
        VISION_LLM_MODEL: config.VISION_LLM_MODEL,
      }
    : undefined;

  const log = {
    info: (o: object, m: string) => console.log(`[info] ${m}`, o),
    warn: (o: object, m: string) => console.warn(`[warn] ${m}`, o),
  };

  const { artifact } = await captureAssets(crawl.payload, {
    s3Client,
    bucket,
    snapshotPrefix,
    log,
    vision: visionConfig,
  });

  await saveArtifact(db, ctx, "mirror-assets", artifact);
  console.log(`Saved mirror-assets artifact with ${artifact.assets.length} assets, ${artifact.assets.filter((a) => a.visionTags).length} vision-tagged`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
