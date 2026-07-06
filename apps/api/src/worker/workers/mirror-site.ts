import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import type { QueueConfig } from "../../bullmq";

export function mirrorSiteProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["mirror_site"]["data"]>) => {
    const { siteUuid, workspaceUuid } = job.data;
    fastify.log.info({ jobId: job.id, siteUuid }, "Mirror site worker started");
    const { runMirrorPipeline } = await import("../../services/mirror/run-mirror.js");

    try {
      const result = await runMirrorPipeline({
        db: fastify.db,
        config: fastify.config,
        siteUuid,
        workspaceUuid,
        log: fastify.log,
      });

      fastify.log.info({ jobId: job.id, result }, "Mirror site worker finished");

      // After a successful mirror, kick off the content extraction pipeline so the
      // structured content model (business-info, brand-guidelines, site-hierarchy)
      // is ready for Phase 2 template matching before the gym approves the preview.
      await triggerContentExtraction(fastify, siteUuid, workspaceUuid);

      return result;
    } catch (err) {
      fastify.log.error({ jobId: job.id, err, siteUuid }, "Mirror site worker failed");
      // runMirrorPipeline sets mirrorStatus: "failed" in its own catch, but this
      // guard handles any unexpected error that bypasses that path
      try {
        await fastify.db
          .updateTable("sites")
          .set({ mirrorStatus: "failed" })
          .where("uuid", "=", siteUuid)
          .execute();
      } catch { /* ignore secondary failure */ }
      throw err;
    }
  };
}

async function triggerContentExtraction(
  fastify: FastifyInstance,
  siteUuid: string,
  workspaceUuid: string,
): Promise<void> {
  try {
    const site = await fastify.db
      .selectFrom("sites")
      .select("sourceUrl")
      .where("uuid", "=", siteUuid)
      .executeTakeFirst();

    if (!site?.sourceUrl) return;

    await fastify.queues.pipeline.queue.add(
      "pipeline",
      {
        kind: "run",
        siteUuid,
        workspaceUuid,
        input: { url: site.sourceUrl },
      },
      // Deduplicate: if a docgen job is already queued for this site, don't add another
      { jobId: `docgen-${siteUuid}` },
    );

    fastify.log.info({ siteUuid, sourceUrl: site.sourceUrl }, "Content extraction queued after mirror");
  } catch (err) {
    // Don't fail the mirror job if docgen enqueueing fails — it can be run manually
    fastify.log.warn({ siteUuid, err }, "Failed to queue content extraction after mirror");
  }
}
