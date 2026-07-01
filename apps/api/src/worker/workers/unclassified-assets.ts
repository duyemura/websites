import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";

export function unclassifiedAssetsProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["unclassified_assets"]["data"]>) => {
    fastify.log.info(
      { jobId: job.id, assetUuid: job.data.assetUuid, reason: job.data.reason },
      "Unclassified asset queued for later review",
    );
  };
}
