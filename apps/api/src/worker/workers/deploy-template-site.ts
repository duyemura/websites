import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import path from "node:path";
import { getS3Client } from "../../s3";
import { deployTemplate } from "../../services/template/deploy-template";
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
      log: {
        info: (o, m) => fastify.log.info(o, m),
        warn: (o, m) => fastify.log.warn(o, m),
      },
    });

    fastify.log.info({ jobId: job.id, siteUuid, version: result.version, deployPrefix: result.deployPrefix }, "deploy-template worker finished");
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
