import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";

export function generatePageProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["generate_page"]["data"]>) => {
    fastify.log.info({ jobId: job.id, data: job.data }, "Generate page worker started");

    const orchestrator = await import("../../services/site-generation-orchestrator.js");
    const result = await orchestrator.buildPage({
      db: fastify.db,
      queues: fastify.queues,
      config: fastify.config,
      workspaceUuid: job.data.workspaceUuid,
      siteUuid: job.data.siteUuid,
      pageSlug: job.data.pageSlug,
      aiJobUuid: job.data.aiJobUuid,
      attemptId: job.data.attemptId,
      mode: job.data.mode,
      referenceScreenshotUrl: job.data.referenceScreenshotUrl,
    });

    fastify.log.info({ jobId: job.id, result }, "Generate page worker finished");
    return result;
  };
}
