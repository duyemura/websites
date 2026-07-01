import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";
import { logAiActivity } from "../../services/ai-activity";

export function sitePublishProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["site_publish"]["data"]>) => {
    const { siteUuid, deploymentUuid } = job.data;
    fastify.log.info({ jobId: job.id, siteUuid, deploymentUuid }, "Site publish worker started");

    const site = await fastify.db
      .selectFrom("sites")
      .selectAll()
      .where("uuid", "=", siteUuid)
      .executeTakeFirst();

    if (!site) {
      throw new Error(`Site ${siteUuid} not found`);
    }

    await fastify.db
      .updateTable("sites")
      .set({
        status: "published",
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where("uuid", "=", siteUuid)
      .execute();

    await logAiActivity(fastify.db, {
      workspaceUuid: site.workspaceUuid,
      userUuid: "system",
      siteUuid,
      actionType: "publish",
      outcome: "success",
      summary: `Published site ${site.name}`,
      metadata: { deploymentUuid },
    });

    fastify.log.info({ jobId: job.id, siteUuid }, "Site publish worker finished");
    return { published: true, siteUuid };
  };
}
