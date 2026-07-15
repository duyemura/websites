import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { getS3Client } from "../../s3";
import { listSiteVersions, publishSiteVersion } from "../../services/site-versions";

const Params = z.object({ siteUuid: z.string().uuid() });
const PublishParams = Params.extend({ version: z.coerce.number().int().positive() });
const ErrorSchema = z.object({ error: z.string() });

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  async function ownedSite(siteUuid: string, workspaceUuid: string) {
    return fastify.db.selectFrom("sites").select("uuid")
      .where("uuid", "=", siteUuid).where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
  }

  fastify.get(
    "/sites/:siteUuid/versions",
    {
      schema: {
        params: Params,
        response: {
          200: z.array(z.object({
            uuid: z.string(),
            siteUuid: z.string(),
            workspaceUuid: z.string(),
            version: z.number(),
            kind: z.string(),
            deployPrefix: z.string(),
            label: z.string().nullable(),
            createdAt: z.coerce.date(),
            publishedAt: z.coerce.date().nullable(),
          })),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) return reply.code(404).send({ error: "Site not found" });
      return listSiteVersions(fastify.db, siteUuid);
    },
  );

  fastify.post(
    "/sites/:siteUuid/versions/:version/publish",
    {
      schema: {
        params: PublishParams,
        response: { 200: z.object({ version: z.number(), deployPrefix: z.string() }), 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { siteUuid, version } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) return reply.code(404).send({ error: "Site not found" });
      const config = fastify.config;
      const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
      const s3Client = getS3Client({
        endpoint: config.S3_ENDPOINT, region: config.S3_REGION,
        accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY,
      });
      try {
        return await publishSiteVersion(
          fastify.db, s3Client, bucket, siteUuid, version,
          config.CLOUDFRONT_DISTRIBUTION_ID,
          config.CLOUDFRONT_KVS_ARN,
          config.MILO_PREVIEW_DOMAIN,
          config,
        );
      } catch (err) {
        return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  done();
};

export default app;
