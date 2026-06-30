import type { Job } from "bullmq";
import type { FastifyInstance } from "fastify";
import type { QueueConfig } from "../../bullmq";

export function generateAssetsProcessor(_fastify: FastifyInstance) {
  return async (_job: Job<QueueConfig["generate_assets"]["data"]>) => {
    throw new Error("generate_assets worker is not implemented yet");
  };
}
