import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import formbody from "@fastify/formbody";
import { handleFormSubmission } from "../../services/leads";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

// In-memory rate limit — known limitation (single process); Redis-backed limit
// arrives with the forms-as-a-system workstream.
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  void fastify.register(formbody);

  fastify.post(
    "/forms/:siteUuid/:formId",
    {
      schema: {
        params: z.object({ siteUuid: z.string().uuid(), formId: z.string().max(200) }),
      },
    },
    async (request, reply) => {
      const ip = request.ip;
      if (rateLimited(ip)) return reply.code(429).send({ error: "Too many submissions" });

      const { siteUuid, formId } = request.params;
      const fields = (request.body ?? {}) as Record<string, unknown>;
      const referer = typeof request.headers.referer === "string" ? request.headers.referer : null;
      let sourcePath: string | null = null;
      try { sourcePath = referer ? new URL(referer).pathname : null; } catch { /* bad referer */ }

      const result = await handleFormSubmission(fastify.db, { siteUuid, formId, fields, sourcePath, ip });
      if (result.stored) fastify.log.info({ siteUuid, formId }, "lead captured");

      // Behave identically whether stored or honeypot-dropped — don't tip off bots.
      if (referer) {
        try {
          const back = new URL(referer);
          back.searchParams.set("submitted", "1");
          return reply.code(303).redirect(back.toString());
        } catch { /* fall through */ }
      }
      return reply.code(200).send({ ok: true });
    },
  );

  done();
};

export default app;
