import { getS3Client, buildS3ObjectUrl } from "../../s3";
import { saveArtifact, loadArtifact } from "../../utils/pipeline/artifact-store";
import { crawlSite } from "./crawl";
import { captureAssets } from "./capture-assets";
import { buildSnapshot } from "./snapshot";
import { deploySnapshot, promoteDeploy } from "./deploy";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { MirrorSnapshotArtifact } from "../../types/mirror";

export interface RunMirrorInput {
  db: Kysely<DB>;
  config: {
    S3_ENDPOINT?: string;
    S3_REGION: string;
    S3_ACCESS_KEY: string;
    S3_SECRET_KEY: string;
    S3_ASSETS_BUCKET: string;
    S3_DEPLOYMENTS_BUCKET?: string;
  };
  siteUuid: string;
  workspaceUuid: string;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export interface RunMirrorResult {
  previewUrl: string;
  pageCount: number;
  warnings: string[];
}

export async function runMirrorPipeline(input: RunMirrorInput): Promise<RunMirrorResult> {
  const { db, config, siteUuid, workspaceUuid, log } = input;
  const ctx = { siteUuid, workspaceUuid };
  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  const s3Client = getS3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  });
  const publicUrl = (key: string) =>
    buildS3ObjectUrl({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket, key });

  const site = await db
    .selectFrom("sites")
    .select(["sourceUrl", "slug"])
    .where("uuid", "=", siteUuid)
    .executeTakeFirstOrThrow();

  if (!site.sourceUrl) throw new Error("Site has no sourceUrl to mirror");

  await db.updateTable("sites").set({ mirrorStatus: "crawling" }).where("uuid", "=", siteUuid).execute();

  const prevSnapshot = await loadArtifact<MirrorSnapshotArtifact>(db, ctx, "mirror-snapshot");
  const snapshotVersion = (prevSnapshot?.version ?? 0) + 1;
  const snapshotPrefix = `sites/${siteUuid}/snapshots/${snapshotVersion}`;

  // Stage 1: crawl
  const crawl = await crawlSite(site.sourceUrl, {
    siteUuid,
    workspaceUuid,
    s3: {
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
      bucket,
    },
    crawlVersion: snapshotVersion,
    log,
  });

  if (crawl.pages.length === 0) {
    await db.updateTable("sites").set({ mirrorStatus: "failed" }).where("uuid", "=", siteUuid).execute();
    throw new Error(`Mirror crawl captured 0 pages: ${JSON.stringify(crawl.failures)}`);
  }
  await saveArtifact(db, ctx, "mirror-crawl", crawl);

  // Stage 2: asset capture
  const { artifact: assetsArtifact } = await captureAssets(crawl, {
    s3Client,
    bucket,
    snapshotPrefix,
    log,
  });
  await saveArtifact(db, ctx, "mirror-assets", assetsArtifact);

  // Stage 3: snapshot (rewrite pages into versioned S3 prefix)
  const snapshot = await buildSnapshot(crawl, assetsArtifact, {
    s3Client,
    bucket,
    siteUuid,
    snapshotVersion,
    log,
  });
  await saveArtifact(db, ctx, "mirror-snapshot", snapshot);

  // Stage 4: deploy (apply transforms → dist)
  const deployId = `${snapshotVersion}-${String(Date.now())}`;
  const host = new URL(publicUrl("")).origin;
  const deploy = await deploySnapshot(snapshot, {
    db,
    s3Client,
    bucket,
    siteUuid,
    deployId,
    host,
    preview: true,
    publicUrl,
    log: { info: log.info },
  });

  // Promote to stable serving prefix for CloudFront
  await promoteDeploy(s3Client, bucket, siteUuid, deploy.deployPrefix);

  await saveArtifact(db, ctx, "mirror-deploy", { ...deploy, host, preview: true });

  await db.updateTable("sites").set({ mirrorStatus: "mirrored" }).where("uuid", "=", siteUuid).execute();

  return {
    previewUrl: deploy.previewUrl,
    pageCount: deploy.pageCount,
    warnings: snapshot.warnings,
  };
}
