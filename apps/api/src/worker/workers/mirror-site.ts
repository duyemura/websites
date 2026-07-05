import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import type { QueueConfig } from "../../bullmq";

export function mirrorSiteProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["mirror_site"]["data"]>) => {
    fastify.log.info({ jobId: job.id, data: job.data }, "Mirror site worker started");
    const { runMirrorPipeline } = await import("../../services/mirror/run-mirror.js");
    const result = await runMirrorPipeline({
      db: fastify.db,
      config: fastify.config,
      siteUuid: job.data.siteUuid,
      workspaceUuid: job.data.workspaceUuid,
      log: fastify.log,
    });
    fastify.log.info({ jobId: job.id, result }, "Mirror site worker finished");
    return result;
  };
}
