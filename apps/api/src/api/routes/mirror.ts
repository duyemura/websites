import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { loadArtifact } from "../../utils/pipeline/artifact-store";
import type { MirrorCrawlArtifact, MirrorAssetsArtifact, MirrorSnapshotArtifact } from "../../types/mirror";

const Params = z.object({ siteUuid: z.string().uuid() });

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  /** Verify the site exists and belongs to the requesting workspace. */
  async function ownedSite(siteUuid: string, workspaceUuid: string) {
    return fastify.db
      .selectFrom("sites")
      .select(["uuid", "mirrorStatus", "sourceUrl"])
      .where("uuid", "=", siteUuid)
      .where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
  }

  // ---------------------------------------------------------------------------
  // POST /sites/:siteUuid/mirror — enqueue a mirror job
  // ---------------------------------------------------------------------------
  fastify.post(
    "/sites/:siteUuid/mirror",
    {
      schema: {
        params: Params,
        response: {
          202: z.object({ status: z.string() }),
          400: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });
      if (!site.sourceUrl) return reply.code(400).send({ error: "Site has no sourceUrl — set it before mirroring" });

      await fastify.db
        .updateTable("sites")
        .set({ mirrorStatus: "queued" })
        .where("uuid", "=", siteUuid)
        .execute();

      await fastify.queues.mirrorSite.queue.add("mirror_site", {
        siteUuid,
        workspaceUuid: request.workspace.uuid,
      });

      return reply.code(202).send({ status: "queued" });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /sites/:siteUuid/mirror — status + latest artifact summaries
  // ---------------------------------------------------------------------------
  fastify.get(
    "/sites/:siteUuid/mirror",
    {
      schema: {
        params: Params,
        response: {
          200: z.object({
            mirrorStatus: z.string().nullable(),
            sourceUrl: z.string().nullable(),
            pageCount: z.number().nullable(),
            previewUrl: z.string().nullable(),
            warnings: z.array(z.string()),
          }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      const ctx = { siteUuid, workspaceUuid: request.workspace.uuid };
      const [snapshot, deploy] = await Promise.all([
        loadArtifact<MirrorSnapshotArtifact>(fastify.db, ctx, "mirror-snapshot"),
        loadArtifact<{ previewUrl: string; pageCount: number; warnings: string[] }>(
          fastify.db, ctx, "mirror-deploy",
        ),
      ]);

      return {
        mirrorStatus: site.mirrorStatus,
        sourceUrl: site.sourceUrl ?? null,
        pageCount: deploy?.payload.pageCount ?? null,
        previewUrl: deploy?.payload.previewUrl ?? null,
        warnings: snapshot?.payload.warnings ?? [],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /sites/:siteUuid/mirror/artifacts — inspect stage artifacts for debugging
  //
  // Returns a summary of each mirror stage artifact so you can see exactly what
  // pages were crawled, which assets were captured, and what warnings exist —
  // without having to dig through raw S3 keys.
  //
  // Example:
  //   curl -H "Authorization: Bearer $TOKEN" \
  //        -H "x-workspace-slug: my-gym" \
  //        https://api.ploygyms.com/api/sites/$SITE_UUID/mirror/artifacts
  // ---------------------------------------------------------------------------
  fastify.get(
    "/sites/:siteUuid/mirror/artifacts",
    { schema: { params: Params } },
    async (request, reply) => {
      const { siteUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) return reply.code(404).send({ error: "Site not found" });

      const ctx = { siteUuid, workspaceUuid: request.workspace.uuid };
      const [crawl, assets, snapshot, deploy] = await Promise.all([
        loadArtifact<MirrorCrawlArtifact>(fastify.db, ctx, "mirror-crawl"),
        loadArtifact<MirrorAssetsArtifact>(fastify.db, ctx, "mirror-assets"),
        loadArtifact<MirrorSnapshotArtifact>(fastify.db, ctx, "mirror-snapshot"),
        loadArtifact<{ previewUrl: string; pageCount: number; warnings: string[] }>(
          fastify.db, ctx, "mirror-deploy",
        ),
      ]);

      return {
        crawl: crawl
          ? {
              version: crawl.version,
              capturedAt: crawl.createdAt,
              pageCount: crawl.payload.pages.length,
              pages: crawl.payload.pages.map((p) => ({
                path: p.path,
                title: p.title,
                formCount: p.forms.length,
                dynamicRegions: p.dynamicRegions.map((r) => ({
                  kind: r.kind,
                  evidence: r.evidence,
                })),
                embedHosts: p.embeds,
              })),
              redirects: crawl.payload.redirects,
              failures: crawl.payload.failures,
            }
          : null,
        assets: assets
          ? {
              version: assets.version,
              capturedAt: assets.createdAt,
              assetCount: assets.payload.assets.length,
              failureCount: assets.payload.failures.length,
              failures: assets.payload.failures,
            }
          : null,
        snapshot: snapshot
          ? {
              version: snapshot.version,
              capturedAt: snapshot.createdAt,
              s3Prefix: snapshot.payload.s3Prefix,
              pageCount: snapshot.payload.pages.length,
              assetCount: snapshot.payload.assetCount,
              warnings: snapshot.payload.warnings,
            }
          : null,
        deploy: deploy
          ? {
              version: deploy.version,
              capturedAt: deploy.createdAt,
              previewUrl: deploy.payload.previewUrl,
              pageCount: deploy.payload.pageCount,
              warnings: deploy.payload.warnings,
            }
          : null,
      };
    },
  );

  done();
};

export default app;
