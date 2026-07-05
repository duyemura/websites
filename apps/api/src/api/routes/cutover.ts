import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { getS3Client, buildS3ObjectUrl } from "../../s3";
import { loadArtifact, saveArtifact } from "../../utils/pipeline/artifact-store";
import { deploySnapshot, promoteDeploy } from "../../services/mirror/deploy";
import { generateDnsInstructions, nextMirrorStatus, verifyDns } from "../../services/mirror/cutover";
import type { MirrorSnapshotArtifact } from "../../types/mirror";

const Params = z.object({ siteUuid: z.string().uuid() });
const ErrorSchema = z.object({ error: z.string() });
const CutoverBody = z.object({
  domain: z.string().min(3),
  cloudfrontDomain: z.string().min(3),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  async function ownedSite(siteUuid: string, workspaceUuid: string) {
    return fastify.db
      .selectFrom("sites")
      .select(["uuid", "mirrorStatus", "customDomain", "slug"])
      .where("uuid", "=", siteUuid)
      .where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
  }

  function transition409(current: string | null) {
    return { error: `Invalid state transition from "${current ?? "null"}"` };
  }

  // ---------------------------------------------------------------------------
  // POST /sites/:siteUuid/mirror/approve — gym approves preview
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
  // POST /sites/:siteUuid/mirror/cutover — start cutover, get DNS instructions
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

      await fastify.db
        .updateTable("sites")
        .set({ mirrorStatus: next, customDomain: domain })
        .where("uuid", "=", siteUuid)
        .execute();

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
        body: CutoverBody,
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

      const { domain, cloudfrontDomain } = request.body;
      const { wwwOk, apexOk } = await verifyDns(domain, cloudfrontDomain);

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
  // POST /sites/:siteUuid/mirror/go-live — flip to production deploy
  // ---------------------------------------------------------------------------
  fastify.post(
    "/sites/:siteUuid/mirror/go-live",
    {
      schema: {
        params: Params,
        response: {
          200: z.object({ status: z.string(), previewUrl: z.string() }),
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      const next = nextMirrorStatus(site.mirrorStatus ?? "", "go_live");
      if (!next) return reply.code(409).send(transition409(site.mirrorStatus));
      if (!site.customDomain) {
        return reply.code(409).send({ error: "No custom domain set — run /cutover first" });
      }

      const ctx = { siteUuid, workspaceUuid: request.workspace.uuid };
      const snapshot = await loadArtifact<MirrorSnapshotArtifact>(fastify.db, ctx, "mirror-snapshot");
      if (!snapshot) {
        return reply.code(409).send({ error: "No snapshot found — mirror the site first" });
      }

      const config = fastify.config;
      const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
      const s3Client = getS3Client({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      });
      const host = `https://${site.customDomain}`;
      const publicUrl = (key: string) =>
        buildS3ObjectUrl({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket, key });

      const deployId = `prod-${Date.now()}`;
      const deploy = await deploySnapshot(snapshot.payload, {
        db: fastify.db,
        s3Client,
        bucket,
        siteUuid,
        deployId,
        host,
        preview: false,
        publicUrl,
        log: { info: (o, m) => fastify.log.info(o, m) },
      });

      await saveArtifact(fastify.db, ctx, "mirror-deploy", {
        ...deploy,
        host,
        preview: false,
        snapshotWarnings: snapshot.payload.warnings,
      });

      await promoteDeploy(s3Client, bucket, siteUuid, deploy.deployPrefix);

      await fastify.db
        .updateTable("sites")
        .set({ mirrorStatus: next })
        .where("uuid", "=", siteUuid)
        .execute();

      fastify.log.info({ siteUuid, host }, "Site went live");
      return { status: next, previewUrl: deploy.previewUrl };
    },
  );

  done();
};

export default app;
