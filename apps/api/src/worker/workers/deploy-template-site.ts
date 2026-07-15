import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import path from "node:path";
import { getS3Client } from "../../s3";
import { deployTemplate } from "../../services/template/deploy-template";
import { promoteDeploy } from "../../services/mirror/deploy";
import { invalidatePreviewCache } from "../../services/mirror/cloudfront";
import type { QueueConfig } from "../../bullmq";

function deployTemplateSiteProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["deploy_template"]["data"]>): Promise<QueueConfig["deploy_template"]["result"]> => {
    const { siteUuid, workspaceUuid } = job.data;
    fastify.log.info({ jobId: job.id, siteUuid }, "deploy-template worker started");

    const config = fastify.config;
    const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
    const s3Client = getS3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    });

    const site = await fastify.db
      .selectFrom("sites")
      .select(["customDomain"])
      .where("uuid", "=", siteUuid)
      .executeTakeFirstOrThrow();

    const rendererDir = path.resolve(__dirname, "../../../../renderer");

    const result = await deployTemplate({
      db: fastify.db,
      s3Client,
      bucket,
      siteUuid,
      workspaceUuid,
      apiBaseUrl: config.CDN_BASE_URL,
      siteUrl: site.customDomain
        ? `https://${site.customDomain}`
        : `${config.CDN_BASE_URL}/sites/${siteUuid}`,
      rendererDir,
      googleMapsApiKey: config.GOOGLE_PLACES_API_KEY,
      log: {
        info: (o, m) => fastify.log.info(o, m),
        warn: (o, m) => fastify.log.warn(o, m),
      },
    });

    // Promote the immutable deploy to staging so the preview URL reflects the latest build.
    await promoteDeploy(s3Client, bucket, siteUuid, result.deployPrefix);
    const invalidationId = await invalidatePreviewCache(
      config.CLOUDFRONT_DISTRIBUTION_ID,
      config,
    );
    if (invalidationId) {
      fastify.log.info({ invalidationId }, "preview cache invalidated");
    } else {
      fastify.log.warn("preview cache invalidation failed");
    }
    fastify.log.info(
      { jobId: job.id, siteUuid, version: result.version, deployPrefix: result.deployPrefix },
      "deploy-template worker finished; staging promoted and preview cache invalidated",
    );
    return { version: result.version, deployPrefix: result.deployPrefix };
  };
}

export default fp(
  (fastify, _, done) => {
    fastify.queues.deployTemplate.worker.run(deployTemplateSiteProcessor(fastify));
    done();
  },
  { name: "deploy-template-worker", dependencies: ["queues"] },
);
