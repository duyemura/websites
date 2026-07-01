import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";

export function replicateSiteProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["replicate_site"]["data"]>) => {
    fastify.log.info({ jobId: job.id, data: job.data }, "Replicate site worker started");

    const orchestrator = await import("../../services/site-generation-orchestrator.js");
    const result = await orchestrator.startSiteBuild({
      db: fastify.db,
      queues: fastify.queues,
      config: fastify.config,
      workspaceUuid: job.data.workspaceUuid,
      siteUuid: job.data.siteUuid,
      requestedMode: "replication",
      existingAiJobUuid: job.data.aiJobUuid,
    });

    fastify.log.info({ jobId: job.id, result }, "Replicate site worker finished");
    return result;
  };
}
