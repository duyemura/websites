import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { generateDnsInstructions, nextMirrorStatus, verifyDns } from "../../services/mirror/cutover";

const Params = z.object({ siteUuid: z.string().uuid() });
const ErrorSchema = z.object({ error: z.string() });

// I4: validate that the domain is a proper hostname, not a URL or freeform string
const DomainSchema = z
  .string()
  .min(3)
  .regex(
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/,
    "Must be a valid hostname (e.g. torrancetraininglab.com)",
  );

const CutoverBody = z.object({
  domain: DomainSchema,
  cloudfrontDomain: DomainSchema,
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  async function ownedSite(siteUuid: string, workspaceUuid: string) {
    return fastify.db
      .selectFrom("sites")
      .select(["uuid", "mirrorStatus", "customDomain", "cloudfrontDomain", "slug"])
      .where("uuid", "=", siteUuid)
      .where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
  }

  function transition409(current: string | null) {
    return { error: `Invalid state transition from "${current ?? "null"}"` };
  }

  // ---------------------------------------------------------------------------
  // POST /sites/:siteUuid/mirror/approve — gym approves the preview
  // ---------------------------------------------------------------------------
  fastify.post(
    "/sites/:siteUuid/mirror/approve",
    {
      schema: {
        params: Params,
        response: {
          200: z.object({ status: z.string() }),
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      const next = nextMirrorStatus(site.mirrorStatus ?? "", "approve");
      if (!next) return reply.code(409).send(transition409(site.mirrorStatus));

      await fastify.db
        .updateTable("sites")
        .set({ mirrorStatus: next })
        .where("uuid", "=", siteUuid)
        .execute();

      return { status: next };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /sites/:siteUuid/mirror/cutover — record DNS targets, get instructions
  // ---------------------------------------------------------------------------
  fastify.post(
    "/sites/:siteUuid/mirror/cutover",
    {
      schema: {
        params: Params,
        body: CutoverBody,
        response: {
          200: z.object({ instructions: z.string(), status: z.string() }),
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      const next = nextMirrorStatus(site.mirrorStatus ?? "", "start_cutover");
      if (!next) return reply.code(409).send(transition409(site.mirrorStatus));

      const { domain, cloudfrontDomain } = request.body;

      // C1: persist both domain and cloudfrontDomain so verify-dns can use the
      // stored values rather than trusting a second caller-supplied payload
      try {
        await fastify.db
          .updateTable("sites")
          .set({ mirrorStatus: next, customDomain: domain, cloudfrontDomain })
          .where("uuid", "=", siteUuid)
          .execute();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("unique") || msg.includes("duplicate")) {
          return reply.code(409).send({ error: `Domain "${domain}" is already in use by another site` });
        }
        throw err;
      }

      return {
        status: next,
        instructions: generateDnsInstructions(domain, cloudfrontDomain),
      };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /sites/:siteUuid/mirror/verify-dns — check DNS propagation
  // ---------------------------------------------------------------------------
  fastify.post(
    "/sites/:siteUuid/mirror/verify-dns",
    {
      schema: {
        params: Params,
        // No body — uses the stored customDomain + cloudfrontDomain (C1)
        response: {
          200: z.object({ wwwOk: z.boolean(), apexOk: z.boolean(), status: z.string() }),
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      if (site.mirrorStatus !== "dns_pending") {
        return reply.code(409).send(transition409(site.mirrorStatus));
      }
      if (!site.customDomain || !site.cloudfrontDomain) {
        return reply.code(409).send({ error: "Run /cutover first to record the domain and CloudFront target" });
      }

      // C1: verify against the stored values, not caller-supplied values
      const { wwwOk, apexOk } = await verifyDns(site.customDomain, site.cloudfrontDomain);

      if (wwwOk && apexOk) {
        const next = nextMirrorStatus("dns_pending", "dns_verified")!;
        await fastify.db
          .updateTable("sites")
          .set({ mirrorStatus: next })
          .where("uuid", "=", siteUuid)
          .execute();
        return { wwwOk, apexOk, status: next };
      }

      return { wwwOk, apexOk, status: "dns_pending" };
    },
  );

  // ---------------------------------------------------------------------------
  // POST /sites/:siteUuid/mirror/go-live — enqueue production deploy (async)
  // ---------------------------------------------------------------------------
  fastify.post(
    "/sites/:siteUuid/mirror/go-live",
    {
      schema: {
        params: Params,
        response: {
          202: z.object({ status: z.string() }),
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      if (!site.customDomain) {
        return reply.code(409).send({ error: "No custom domain set — run /cutover first" });
      }

      // I8/C2: atomic conditional UPDATE prevents double-submission race and
      // ensures the state machine transitions exactly once. If numUpdatedRows is 0,
      // either someone else already triggered go-live or the site isn't dns_verified.
      const updated = await fastify.db
        .updateTable("sites")
        .set({ mirrorStatus: "deploying" })
        .where("uuid", "=", siteUuid)
        .where("mirrorStatus", "=", "dns_verified")
        .executeTakeFirst();

      if (updated.numUpdatedRows === 0n) {
        return reply.code(409).send(transition409(site.mirrorStatus));
      }

      // C2: enqueue the production deploy as a background job — S3 operations
      // (copy 50+ pages + assets) can take 30-120s, too slow for a sync handler
      await fastify.queues.goLiveSite.queue.add(
        "go_live_site",
        { siteUuid, workspaceUuid: request.workspace.uuid },
        { jobId: `go-live-${siteUuid}` },
      );

      return reply.code(202).send({ status: "deploying" });
    },
  );

  done();
};

export default app;
