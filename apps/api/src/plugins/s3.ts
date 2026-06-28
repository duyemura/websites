import fp from "fastify-plugin";
import { createS3StorageProvider, ensureBuckets, getS3Client } from "../s3";
import type { StorageProvider } from "../storage";

export default fp(
  async (fastify) => {
    const config = fastify.config;
    const s3 = getS3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    });

    await ensureBuckets(s3, [
      config.S3_ASSETS_BUCKET,
      config.S3_DEPLOYMENTS_BUCKET ?? "ploygyms-dev-deployments",
    ]);

    const storage = createS3StorageProvider({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
      bucket: config.S3_ASSETS_BUCKET,
      cdnBaseUrl: config.CDN_BASE_URL,
    });

    fastify.decorate("storage", storage);
  },
  { name: "s3", dependencies: ["env"] },
);

declare module "fastify" {
  interface FastifyInstance {
    storage: StorageProvider;
  }
}
