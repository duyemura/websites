import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import formbody from "@fastify/formbody";
import { handleFormSubmission } from "../../services/leads";

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

// Evict IPs whose last hit was more than WINDOW_MS ago to prevent unbounded map growth.
// Runs every 5 minutes — infrequent enough not to affect hot paths.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, times] of hits) {
    if (times.length === 0 || (times[times.length - 1] ?? 0) < cutoff) hits.delete(ip);
  }
}, 5 * 60_000).unref();

const THANK_YOU_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="robots" content="noindex"><title>Thank you</title></head>
<body style="font-family:sans-serif;text-align:center;padding:4rem">
<h1>Thanks — we'll be in touch!</h1></body></html>`;

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  void fastify.register(formbody);

  fastify.post(
    "/forms/:siteUuid/:formId",
    {
      bodyLimit: 65536,
      schema: {
        params: z.object({ siteUuid: z.string().uuid(), formId: z.string().max(200) }),
      },
    },
    async (request, reply) => {
      const ip = request.ip;
      const acceptsJson = (request.headers.accept ?? "").includes("application/json");
      if (rateLimited(ip)) {
        // Behave identically to a successful submission — don't tip off bots.
        return acceptsJson
          ? reply.code(201).send({ ok: true })
          : reply.code(200).type("text/html").send(THANK_YOU_HTML);
      }

      const { siteUuid, formId } = request.params;
      const fields = (request.body ?? {}) as Record<string, unknown>;
      const referer = typeof request.headers.referer === "string" ? request.headers.referer : null;
      let sourcePath: string | null = null;
      try {
        sourcePath = referer ? new URL(referer).pathname : null;
      } catch { /* bad referer */ }

      const result = await handleFormSubmission(
        fastify.db,
        { siteUuid, formId, fields, sourcePath, ip },
        {
          enqueueNotify: (leadUuid, sid) =>
            fastify.queues.leadNotify.queue.add("lead_notify", { leadUuid, siteUuid: sid }).then(() => undefined),
        },
      );
      if (result.stored) fastify.log.info({ siteUuid, formId }, "lead captured");

      if (acceptsJson) {
        return reply.code(201).send({ ok: true });
      }

      // Native form-encoded path: redirect to referer with ?submitted=1, or serve thank-you page
      if (referer) {
        try {
          const back = new URL(referer);
          back.searchParams.set("submitted", "1");
          return reply.code(303).redirect(back.toString());
        } catch { /* fall through */ }
      }
      return reply.code(200).type("text/html").send(THANK_YOU_HTML);
    },
  );

  done();
};

export default app;
