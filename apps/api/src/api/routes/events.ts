import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { Redis } from "ioredis";
import { eventMatchesFilter, type SiteEvent } from "../../services/events.js";

const HEARTBEAT_INTERVAL_MS = 30000;

function channelName(workspaceUuid: string): string {
  return `events:${workspaceUuid}`;
}

function createSubscriber(): Redis {
  return new Redis({
    host: process.env.REDIS_HOST,
    port: Number(process.env.REDIS_PORT || 6379),
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  });
}

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/sites/:uuid/events",
    {
      schema: {
        operationId: "getSiteEvents",
        tags: ["Sites"],
        summary: "Server-Sent Events stream for site activity",
        description:
          "Streams pipeline, AI activity, deployment, and site update events for a workspace-scoped site. Reconnects are safe; missed events are not buffered.",
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: z.any(),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const workspaceUuid = request.workspace.uuid;
      const siteUuid = request.params.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.write(`data: ${JSON.stringify({ type: "stream.opened", siteUuid, workspaceUuid, timestamp: new Date().toISOString() })}\n\n`);

      const subscriber = createSubscriber();
      let heartbeat: ReturnType<typeof setInterval> | null = setInterval(() => {
        try {
          reply.raw.write(":heartbeat\n\n");
        } catch (err) {
          fastify.log.warn({ err }, "SSE heartbeat failed; closing connection");
          cleanup();
        }
      }, HEARTBEAT_INTERVAL_MS);

      function cleanup(): void {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        void subscriber
          .unsubscribe(channelName(workspaceUuid))
          .then(() => subscriber.quit())
          .catch(() => {
            // Subscriber may already be disconnected.
          });
        try {
          reply.raw.end();
        } catch {
          // Already closed.
        }
      }

      subscriber.on("message", (_channel, message) => {
        try {
          const event = JSON.parse(message) as SiteEvent;
          if (
            eventMatchesFilter(event, {
              workspaceUuid,
              siteUuid,
            })
          ) {
            reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        } catch (err) {
          fastify.log.warn({ err }, "Failed to forward SSE event");
        }
      });

      subscriber.on("error", (err) => {
        fastify.log.warn({ err }, "SSE subscriber error");
        cleanup();
      });

      await subscriber.subscribe(channelName(workspaceUuid));

      request.raw.on("close", cleanup);
      request.raw.on("error", cleanup);
      reply.raw.on("error", cleanup);

      // Keep the handler alive until the client disconnects.
      return new Promise<void>(() => {});
    },
  );

  done();
};

export default app;
