import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import type { QueueConfig } from "../../bullmq";
import { getS3Client, buildS3ObjectUrl } from "../../s3";
import { loadArtifact, saveArtifact } from "../../utils/pipeline/artifact-store";
import { deploySnapshot, promoteDeploy } from "../../services/mirror/deploy";
import type { MirrorSnapshotArtifact } from "../../types/mirror";

export function goLiveSiteProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["go_live_site"]["data"]>) => {
    const { siteUuid, workspaceUuid } = job.data;
    fastify.log.info({ jobId: job.id, siteUuid }, "Go-live worker started");

    try {
      const site = await fastify.db
        .selectFrom("sites")
        .select(["customDomain", "mirrorStatus"])
        .where("uuid", "=", siteUuid)
        .executeTakeFirstOrThrow();

      if (!site.customDomain) throw new Error("No customDomain set on site");

      const ctx = { siteUuid, workspaceUuid };
      const snapshot = await loadArtifact<MirrorSnapshotArtifact>(
        fastify.db, ctx, "mirror-snapshot",
      );
      if (!snapshot) throw new Error("No snapshot found — mirror the site first");

      const config = fastify.config;
      const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
      const s3Client = getS3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      });
      const host = `https://${site.customDomain}`;
      const publicUrl = (key: string) =>
        buildS3ObjectUrl({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket, key });

      const deployId = `prod-${Date.now()}`;
      const deploy = await deploySnapshot(snapshot.payload, {
        db: fastify.db,
        s3Client,
        bucket,
        siteUuid,
        deployId,
        host,
        preview: false,
        publicUrl,
        log: { info: (o, m) => fastify.log.info(o, m) },
      });

      // Save artifact before promoting so a promote failure leaves an audit trail
      await saveArtifact(fastify.db, ctx, "mirror-deploy", {
        ...deploy,
        host,
        preview: false,
        snapshotWarnings: snapshot.payload.warnings,
      });

      await promoteDeploy(s3Client, bucket, siteUuid, deploy.deployPrefix);

      await fastify.db
        .updateTable("sites")
        .set({ mirrorStatus: "live" })
        .where("uuid", "=", siteUuid)
        .execute();

      // Write customDomain → S3 prefix to CloudFront KVS so the domain routes automatically.
      // Non-fatal: KVS write failure does not roll back the go-live.
      try {
        const { CloudFrontKeyValueStoreClient, PutKeyCommand, DescribeKeyValueStoreCommand } =
          await import("@aws-sdk/client-cloudfront-keyvaluestore");
        const KVS_ARN = fastify.config.CLOUDFRONT_KVS_ARN;
        if (KVS_ARN && site.customDomain) {
          const kvsClient = new CloudFrontKeyValueStoreClient({});
          const desc = await kvsClient.send(new DescribeKeyValueStoreCommand({ KvsARN: KVS_ARN }));
          await kvsClient.send(new PutKeyCommand({
            KvsARN: KVS_ARN,
            IfMatch: desc.ETag,
            Key: site.customDomain,
            Value: `sites/${siteUuid}/current`,
          }));
          fastify.log.info({ siteUuid, customDomain: site.customDomain }, "KVS routing written");
        }
      } catch (kvsErr) {
        fastify.log.warn({ siteUuid, err: kvsErr }, "KVS write failed — domain routing must be set manually");
      }

      fastify.log.info({ jobId: job.id, siteUuid, host }, "Site went live");
      return { status: "live", siteUrl: host };
    } catch (err) {
      fastify.log.error({ jobId: job.id, err, siteUuid }, "Go-live worker failed");
      // Reset to dns_verified so the operator can retry without manual DB intervention (I8)
      try {
        await fastify.db
          .updateTable("sites")
          .set({ mirrorStatus: "dns_verified" })
          .where("uuid", "=", siteUuid)
          .where("mirrorStatus", "=", "deploying")
          .execute();
      } catch { /* ignore secondary failure */ }
      throw err;
    }
  };
}
