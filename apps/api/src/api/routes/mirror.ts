import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { loadArtifact } from "../../utils/pipeline/artifact-store";
import type { PipelineStage } from "../../types/pipeline-artifacts";
import type { MirrorCrawlArtifact, MirrorAssetsArtifact, MirrorSnapshotArtifact } from "../../types/mirror";

const Params = z.object({ siteUuid: z.string().uuid() });
const ErrorSchema = z.object({ error: z.string() });

/** Statuses that mean a mirror job is already running or enqueued. */
const IN_FLIGHT_STATUSES = new Set(["queued", "crawling"]);

// Response schema for the artifacts debug endpoint (I3)
const ArtifactsResponseSchema = z.object({
  crawl: z.object({
    version: z.number(),
    capturedAt: z.coerce.date(),
    pageCount: z.number(),
    pages: z.array(
      z.object({
        path: z.string(),
        title: z.string(),
        formCount: z.number(),
        dynamicRegions: z.array(z.object({ kind: z.string(), evidence: z.string() })),
        embedHosts: z.array(z.string()),
      }),
    ),
    redirects: z.array(z.object({ from: z.string(), to: z.string(), status: z.number() })),
    failures: z.array(z.object({ url: z.string(), reason: z.string() })),
  }).nullable(),
  assets: z.object({
    version: z.number(),
    capturedAt: z.coerce.date(),
    assetCount: z.number(),
    failureCount: z.number(),
    failures: z.array(z.object({ url: z.string(), reason: z.string() })),
  }).nullable(),
  snapshot: z.object({
    version: z.number(),
    capturedAt: z.coerce.date(),
    s3Prefix: z.string(),
    pageCount: z.number(),
    assetCount: z.number(),
    warnings: z.array(z.string()),
  }).nullable(),
  deploy: z.object({
    version: z.number(),
    capturedAt: z.coerce.date(),
    previewUrl: z.string(),
    pageCount: z.number(),
    warnings: z.array(z.string()),
  }).nullable(),
});

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
          400: ErrorSchema,
          404: ErrorSchema,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });
      if (!site.sourceUrl) return reply.code(400).send({ error: "Site has no sourceUrl — set it before mirroring" });

      // C3: reject if a job is already in-flight rather than enqueuing a second one
      if (site.mirrorStatus && IN_FLIGHT_STATUSES.has(site.mirrorStatus)) {
        return reply.code(409).send({
          error: `Mirror already in progress (status: ${site.mirrorStatus})`,
        });
      }

      await fastify.db
        .updateTable("sites")
        .set({ mirrorStatus: "queued" })
        .where("uuid", "=", siteUuid)
        .execute();

      // I2: jobId ensures BullMQ deduplicates if this route is called again before
      // the worker picks up the job (e.g. double-click, retry). BullMQ returns the
      // existing job rather than creating a duplicate.
      await fastify.queues.mirrorSite.queue.add(
        "mirror_site",
        { siteUuid, workspaceUuid: request.workspace.uuid },
        { jobId: `mirror-${siteUuid}` },
      );

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
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      const site = await ownedSite(siteUuid, request.workspace.uuid);
      if (!site) return reply.code(404).send({ error: "Site not found" });

      const ctx = { siteUuid, workspaceUuid: request.workspace.uuid };
      // I4: read everything from the deploy artifact so warnings and status are
      // co-versioned from the same pipeline run (no mixing snapshot vN with deploy v(N-1))
      const deploy = await loadArtifact<{
        previewUrl: string;
        pageCount: number;
        warnings: string[];
        snapshotWarnings: string[];
      }>(fastify.db, ctx, "mirror-deploy");

      return {
        mirrorStatus: site.mirrorStatus,
        sourceUrl: site.sourceUrl ?? null,
        pageCount: deploy?.payload.pageCount ?? null,
        previewUrl: deploy?.payload.previewUrl ?? null,
        warnings: [
          ...(deploy?.payload.snapshotWarnings ?? []),
          ...(deploy?.payload.warnings ?? []),
        ],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // GET /sites/:siteUuid/mirror/artifacts — inspect stage artifacts for debugging
  //
  // Returns a summary of each mirror stage artifact so you can see exactly what
  // pages were crawled, which assets were captured, and what warnings exist.
  //
  // Example:
  //   curl -H "Authorization: Bearer $TOKEN" \
  //        -H "x-workspace-slug: my-gym" \
  //        https://api.ploygyms.com/api/sites/$SITE_UUID/mirror/artifacts
  // ---------------------------------------------------------------------------
  fastify.get(
    "/sites/:siteUuid/mirror/artifacts",
    {
      schema: {
        params: Params,
        response: { 200: ArtifactsResponseSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const ctx = { siteUuid, workspaceUuid: request.workspace.uuid };
      const [crawlNew, crawlLegacy, assets, snapshot, deploy] = await Promise.all([
        loadArtifact<MirrorCrawlArtifact>(fastify.db, ctx, "crawl"),
        loadArtifact<MirrorCrawlArtifact>(fastify.db, ctx, "mirror-crawl" as PipelineStage),
        loadArtifact<MirrorAssetsArtifact>(fastify.db, ctx, "mirror-assets"),
        loadArtifact<MirrorSnapshotArtifact>(fastify.db, ctx, "mirror-snapshot"),
        loadArtifact<{ previewUrl: string; pageCount: number; warnings: string[] }>(
          fastify.db, ctx, "mirror-deploy",
        ),
      ]);
      const crawl = crawlNew ?? crawlLegacy;

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
