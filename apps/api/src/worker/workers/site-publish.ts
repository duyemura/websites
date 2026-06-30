import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";

export function sitePublishProcessor(_fastify: FastifyInstance) {
  return async (_job: Job<QueueConfig["site_publish"]["data"]>) => {
    throw new Error("site_publish worker is not implemented yet");
  };
}
