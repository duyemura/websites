import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Job } from "bullmq";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import type { QueueConfig } from "../../bullmq";

function notifyLeadProcessor(fastify: FastifyInstance) {
  return async (job: Job<QueueConfig["lead_notify"]["data"]>): Promise<{ sent: boolean }> => {
    const { leadUuid, siteUuid } = job.data;
    const fromEmail = fastify.config.SES_FROM_EMAIL;
    if (!fromEmail) {
      fastify.log.warn({ leadUuid }, "SES_FROM_EMAIL not configured — skipping notification");
      return { sent: false };
    }

    const lead = await fastify.db
      .selectFrom("leads")
      .select(["uuid", "email", "phone", "name", "sourcePath", "fields", "formId"])
      .where("uuid", "=", leadUuid)
      .executeTakeFirst();

    if (!lead) {
      fastify.log.warn({ leadUuid }, "Lead not found — skipping notification");
      return { sent: false };
    }

    const site = await fastify.db
      .selectFrom("sites")
      .select(["name", "notifyEmail"])
      .where("uuid", "=", siteUuid)
      .executeTakeFirst();

    if (!site?.notifyEmail) {
      fastify.log.warn({ leadUuid, siteUuid }, "Site has no notifyEmail — skipping");
      return { sent: false };
    }

    const fields = lead.fields as Record<string, unknown>;
    const fieldLines = Object.entries(fields)
      .filter(([k]) => k !== "_hp")
      .map(([k, v]) => `  ${k}: ${String(v)}`)
      .join("\n");

    const ses = new SESClient({ region: fastify.config.S3_REGION });
    const subject = `New lead from ${site.name}`;
    const body = [
      `New lead on ${site.name}`,
      ``,
      `Name:  ${lead.name ?? "(not captured)"}`,
      `Email: ${lead.email ?? "(not captured)"}`,
      `Phone: ${lead.phone ?? "(not captured)"}`,
      `Page:  ${lead.sourcePath ?? "(unknown)"}`,
      ``,
      `All fields:`,
      fieldLines,
    ].join("\n");

    await ses.send(
      new SendEmailCommand({
        Source: fromEmail,
        Destination: { ToAddresses: [site.notifyEmail] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: { Text: { Data: body, Charset: "UTF-8" } },
        },
      }),
    );

    fastify.log.info({ leadUuid, to: site.notifyEmail }, "Lead notification sent");
    return { sent: true };
  };
}

export default fp(
  (fastify, _, done) => {
    fastify.queues.leadNotify.worker.run(notifyLeadProcessor(fastify));
    done();
  },
  { name: "notify-lead-worker", dependencies: ["queues"] },
);
