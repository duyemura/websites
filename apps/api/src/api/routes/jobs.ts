import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const JobStatusResponseSchema = z.object({
  found: z.boolean(),
  queue: z.string().optional(),
  state: z.string().optional(),
  progress: z.number().optional(),
  returnvalue: z.unknown().optional(),
  failedReason: z.string().optional(),
  data: z.unknown().optional(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/jobs/:jobId/status",
    {
      schema: {
        operationId: "getJobStatus",
        tags: ["Jobs"],
        summary: "Look up a BullMQ job across all queues",
        params: z.object({ jobId: z.string() }),
        querystring: z.object({ queue: z.string().optional() }),
        response: {
          200: JobStatusResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const requestedQueue = (request.query as { queue?: string }).queue;
      const queues = Object.entries(fastify.queues ?? {});

      // If the caller asks for a specific queue, prefer that one so we don't
      // return a collision from another queue with the same numeric job id.
      if (requestedQueue && requestedQueue in (fastify.queues ?? {})) {
        const queueEntry = fastify.queues[requestedQueue as keyof typeof fastify.queues];
        const job = await queueEntry.queue.getJob(request.params.jobId);
        if (job) {
          return reply.code(200).send({
            found: true,
            queue: requestedQueue,
            state: await job.getState(),
            progress: job.progress ? Number(job.progress) : undefined,
            returnvalue: job.returnvalue,
            failedReason: job.failedReason ?? undefined,
            data: job.data,
          });
        }
      }

      for (const [queueName, queueEntry] of queues) {
        const job = await queueEntry.queue.getJob(request.params.jobId);
        if (job) {
          return reply.code(200).send({
            found: true,
            queue: queueName,
            state: await job.getState(),
            progress: job.progress ? Number(job.progress) : undefined,
            returnvalue: job.returnvalue,
            failedReason: job.failedReason ?? undefined,
            data: job.data,
          });
        }
      }
      return reply.code(200).send({ found: false });
    },
  );

  done();
};

export default app;
