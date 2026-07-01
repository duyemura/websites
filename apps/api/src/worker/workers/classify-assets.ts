import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";
import { analyzeAsset } from "../../utils/asset-analysis";

export function classifyAssetsProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["classify_assets"]["data"]>) => {
    fastify.log.info({ jobId: job.id, data: job.data }, "Classify assets worker started");

    try {
      await analyzeAsset({
        db: fastify.db,
        config: fastify.config,
        workspaceUuid: job.data.workspaceUuid,
        assetUuid: job.data.assetUuid,
        userUuid: job.data.userUuid,
        siteUuid: job.data.siteUuid,
        aiJobUuid: job.data.aiJobUuid,
        log: fastify.log,
      });

      fastify.log.info({ jobId: job.id }, "Classify assets worker finished");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      fastify.log.warn(
        { jobId: job.id, assetUuid: job.data.assetUuid, err },
        "Asset classification failed; moving to unclassified queue",
      );

      await fastify.queues.unclassifiedAssets.queue.add(
        "unclassified_assets",
        {
          workspaceUuid: job.data.workspaceUuid,
          assetUuid: job.data.assetUuid,
          userUuid: job.data.userUuid,
          siteUuid: job.data.siteUuid,
          aiJobUuid: job.data.aiJobUuid,
          reason,
        },
        { jobId: job.data.assetUuid },
      );

      throw err;
    }
  };
}
