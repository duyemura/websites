import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import type { QueueConfig } from "../../bullmq";

export function mirrorSiteProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["mirror_site"]["data"]>) => {
    fastify.log.info({ jobId: job.id, data: job.data }, "Mirror site worker started");
    const { runMirrorPipeline } = await import("../../services/mirror/run-mirror.js");
    try {
      const result = await runMirrorPipeline({
        db: fastify.db,
        config: fastify.config,
        siteUuid: job.data.siteUuid,
        workspaceUuid: job.data.workspaceUuid,
        log: fastify.log,
      });
      fastify.log.info({ jobId: job.id, result }, "Mirror site worker finished");
      return result;
    } catch (err) {
      fastify.log.error({ jobId: job.id, err, data: job.data }, "Mirror site worker failed");
      // runMirrorPipeline sets mirrorStatus: "failed" in its own catch, but this
      // guard handles any unexpected error that bypasses that path (I5)
      try {
        await fastify.db
          .updateTable("sites")
          .set({ mirrorStatus: "failed" })
          .where("uuid", "=", job.data.siteUuid)
          .execute();
      } catch { /* ignore secondary failure */ }
      throw err; // re-throw so BullMQ marks the job failed
    }
  };
}
