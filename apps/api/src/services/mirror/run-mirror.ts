import { getS3Client, buildS3ObjectUrl } from "../../s3";
import { saveArtifact, loadArtifact } from "../../utils/pipeline/artifact-store";
import { crawlSite } from "./crawl";
import { captureAssets } from "./capture-assets";
import { buildSnapshot } from "./snapshot";
import { deploySnapshot, promoteDeploy } from "./deploy";
import type { Kysely } from "kysely";
import type { DB } from "../../types/db";
import type { CrawlTier, MirrorSnapshotArtifact } from "../../types/mirror";
import { CRAWL_TIER_FREE } from "../../types/mirror";

export interface RunMirrorInput {
  db: Kysely<DB>;
  config: {
    S3_ENDPOINT?: string;
    S3_REGION: string;
    S3_ACCESS_KEY: string;
    S3_SECRET_KEY: string;
    S3_ASSETS_BUCKET: string;
    S3_DEPLOYMENTS_BUCKET?: string;
    CDN_BASE_URL: string;
    MILO_PREVIEW_DOMAIN?: string;
    CLOUDFRONT_KVS_ARN?: string;
  };
  siteUuid: string;
  workspaceUuid: string;
  /** Controls page cap and UGC skip. Defaults to free tier (20 structural pages). */
  tier?: CrawlTier;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export interface RunMirrorResult {
  previewUrl: string;
  pageCount: number;
  warnings: string[];
}

export async function runMirrorPipeline(input: RunMirrorInput): Promise<RunMirrorResult> {
  const { db, config, siteUuid, workspaceUuid, log, tier = CRAWL_TIER_FREE } = input;
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

  // C2: derive host from CDN_BASE_URL so it reflects the real publicly-accessible
  // origin, not the internal S3/MinIO endpoint that may be unreachable externally.
  const host = config.CDN_BASE_URL.replace(/\/$/, "");

  const site = await db
    .selectFrom("sites")
    .select(["sourceUrl", "slug"])
    .where("uuid", "=", siteUuid)
    .executeTakeFirstOrThrow();

  if (!site.sourceUrl) throw new Error("Site has no sourceUrl to mirror");

  await db.updateTable("sites").set({ mirrorStatus: "crawling" }).where("uuid", "=", siteUuid).execute();

  // C1: wrap all pipeline stages so any failure resets mirrorStatus to "failed"
  // and re-throws for BullMQ to record the job as failed.
  try {
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
      tier,
      log,
    });

    if (crawl.pages.length === 0) {
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
    const deployId = `${snapshotVersion}-${Date.now()}`;
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

    // I6: save artifact BEFORE promoting so a promote failure doesn't leave
    // current/ updated with no corresponding artifact record.
    // I4: store snapshotWarnings alongside deploy warnings so GET /mirror
    // can read everything from one artifact (avoids version mismatch).
    await saveArtifact(db, ctx, "mirror-deploy", {
      ...deploy,
      host,
      preview: true,
      snapshotWarnings: snapshot.warnings,
    });

    // Promote to stable serving prefix for CloudFront
    await promoteDeploy(s3Client, bucket, siteUuid, deploy.deployPrefix);

    // Auto-write preview subdomain: {uuid}-preview.{MILO_PREVIEW_DOMAIN} → staging
    // Non-fatal: KVS failure does not fail the mirror.
    const previewDomain = config.MILO_PREVIEW_DOMAIN;
    const kvsArn = config.CLOUDFRONT_KVS_ARN;
    if (previewDomain && kvsArn) {
      try {
        const { CloudFrontKeyValueStoreClient, PutKeyCommand, DescribeKeyValueStoreCommand } =
          await import("@aws-sdk/client-cloudfront-keyvaluestore");
        const kvsClient = new CloudFrontKeyValueStoreClient({});
        const desc = await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));
        await kvsClient.send(new PutKeyCommand({
          KvsARN: kvsArn,
          IfMatch: desc.ETag,
          Key: `${siteUuid}-preview.${previewDomain}`,
          Value: `sites/${siteUuid}/staging`,
        }));
        log.info({ siteUuid, previewSubdomain: `${siteUuid}-preview.${previewDomain}` }, "preview subdomain KVS written");
      } catch (kvsErr) {
        log.warn({ siteUuid, err: kvsErr }, "preview KVS write failed — subdomain must be set manually");
      }
    }

    // Record this mirror deploy as version 1 (or next version if re-run)
    const { recordSiteVersion } = await import("../site-versions.js");
    const versionRow = await recordSiteVersion(db, {
      siteUuid, workspaceUuid, kind: "mirror",
      deployPrefix: deploy.deployPrefix, label: "Site capture",
    });
    await db.updateTable("siteVersions").set({ publishedAt: new Date() })
      .where("uuid", "=", versionRow.uuid).execute();

    await db.updateTable("sites").set({ mirrorStatus: "mirrored" }).where("uuid", "=", siteUuid).execute();

    return {
      previewUrl: deploy.previewUrl,
      pageCount: deploy.pageCount,
      warnings: [...snapshot.warnings, ...deploy.warnings],
    };
  } catch (err) {
    await db
      .updateTable("sites")
      .set({ mirrorStatus: "failed" })
      .where("uuid", "=", siteUuid)
      .execute();
    throw err;
  }
}
