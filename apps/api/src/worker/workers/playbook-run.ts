import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";

export function playbookRunProcessor(_fastify: FastifyInstance) {
  return async (_job: Job<QueueConfig["playbook_run"]["data"]>) => {
    throw new Error("playbook_run worker is not implemented yet");
  };
}
