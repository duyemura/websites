import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";
import { analyzeAsset } from "../../utils/asset-analysis";

export function classifyAssetsProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["classify_assets"]["data"]>) => {
    fastify.log.info({ jobId: job.id, data: job.data }, "Classify assets worker started");

    await analyzeAsset({
      db: fastify.db,
      config: fastify.config,
      workspaceUuid: job.data.workspaceUuid,
      assetUuid: job.data.assetUuid,
      userUuid: job.data.userUuid,
      siteUuid: job.data.siteUuid,
      aiJobUuid: job.data.aiJobUuid,
    });

    fastify.log.info({ jobId: job.id }, "Classify assets worker finished");
  };
}
