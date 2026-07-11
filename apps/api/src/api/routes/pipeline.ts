import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

import { REBUILD_STAGES, type PipelineStage } from "../../types/pipeline-artifacts";
import {
  loadArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";

const StageEnum = z.enum(REBUILD_STAGES);
const ModeEnum = z.enum(["replication", "template", "greenfield"]);
const TierEnum = z.enum(["free", "paid"]);

const StagePayloadSchema = z
  .object({
    url: z.string().url().optional(),
    pages: z.array(z.string()).optional(),
    maxPages: z.number().int().positive().max(100).optional(),
    contentSiteUuid: z.string().uuid().optional(),
    designSiteUuid: z.string().uuid().optional(),
    mode: z.enum(["replication", "template", "greenfield"]).optional(),
    tier: TierEnum.optional(),
  })
  .strict()
  .default({});

const PipelineRunBodySchema = z
  .object({
    url: z.string().url(),
    pages: z.array(z.string()).optional(),
    maxPages: z.number().int().positive().max(100).optional(),
    mode: z.enum(["replication", "template", "greenfield"]).optional(),
    tier: TierEnum.optional(),
  })
  .strict();

const StageEnqueueResponseSchema = z.object({
  jobId: z.string(),
  stage: StageEnum,
});

const RunEnqueueResponseSchema = z.object({
  jobId: z.string(),
});

const StageStatusSchema = z
  .object({
    version: z.number().int(),
    createdAt: z.string(),
    stale: z.boolean(),
  })
  .nullable();

const StatusResponseSchema = z.object({
  stages: z.object({
    extract: StageStatusSchema,
    segment: StageStatusSchema,
    contract: StageStatusSchema,
    docgen: StageStatusSchema,
    build: StageStatusSchema,
    verify: StageStatusSchema,
  }),
  scores: z
    .object({
      mechanicalFidelity: z.number(),
      visualFidelity: z.number(),
      masterFidelity: z.number(),
    })
    .nullable(),
});

const ArtifactResponseSchema = z.object({
  version: z.number().int(),
  createdAt: z.string(),
  payload: z.unknown(),
});

const PipelineFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "number", "select", "multiselect", "boolean", "uuid"]),
  required: z.boolean(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  hint: z.string().optional(),
  dependsOn: z.object({ key: z.string(), value: z.string() }).optional(),
});

const PipelineOptionsResponseSchema = z.object({
  stages: z.array(z.string()),
  modes: z.array(z.string()),
  fields: z.array(PipelineFieldSchema),
});

interface StageSummary {
  version: number;
  createdAt: Date;
  payload: unknown;
}

async function loadStageSummary(
  db: import("kysely").Kysely<import("../../types/db").DB>,
  ctx: ArtifactContext,
  stage: PipelineStage,
): Promise<StageSummary | null> {
  const stored = await loadArtifact(db, ctx, stage);
  if (!stored) return null;
  return {
    version: stored.version,
    createdAt: stored.createdAt,
    payload: stored.payload,
  };
}

/**
 * Compute a "stale" flag for a downstream stage by comparing the timestamp
 * that the downstream artifact recorded for its source against the current
 * source artifact's timestamp. Falls back to comparing `createdAt` when the
 * artifact does not carry an explicit source reference.
 */
function isStale(
  downstream: StageSummary | null,
  upstream: StageSummary | null,
  extractRef?: (payload: unknown) => string | undefined,
): boolean {
  if (!downstream || !upstream) return false;

  if (extractRef) {
    const upstreamAt =
      typeof (upstream.payload as { extractedAt?: unknown }).extractedAt ===
      "string"
        ? ((upstream.payload as { extractedAt: string }).extractedAt)
        : upstream.createdAt.toISOString();
    const downstreamSourceAt = extractRef(downstream.payload);
    if (downstreamSourceAt && upstreamAt) {
      return Date.parse(downstreamSourceAt) < Date.parse(upstreamAt);
    }
  }

  // Fallback: compare createdAt timestamps.
  return downstream.createdAt.getTime() < upstream.createdAt.getTime();
}

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  async function requireSite(
    request: { params: { uuid: string }; workspace: { uuid: string } },
    reply: import("fastify").FastifyReply,
  ): Promise<{ siteUuid: string; workspaceUuid: string } | null> {
    const site = await fastify.db
      .selectFrom("sites")
      .select("uuid")
      .where("uuid", "=", request.params.uuid)
      .where("workspaceUuid", "=", request.workspace.uuid)
      .executeTakeFirst();
    if (!site) {
      await reply.code(404).send({ error: "Site not found" });
      return null;
    }
    return {
      siteUuid: request.params.uuid,
      workspaceUuid: request.workspace.uuid,
    };
  }

  fastify.post(
    "/sites/:uuid/pipeline/:stage",
    {
      schema: {
        operationId: "enqueuePipelineStage",
        tags: ["Pipeline"],
        summary: "Enqueue a single pipeline stage",
        params: z.object({
          uuid: z.string().uuid(),
          stage: z.string(),
        }),
        body: StagePayloadSchema.optional(),
        response: {
          202: StageEnqueueResponseSchema.extend({ queue: z.literal("pipeline") }),
          400: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const parsedStage = StageEnum.safeParse(request.params.stage);
      if (!parsedStage.success) {
        return reply.code(400).send({
          error: `Unknown stage "${request.params.stage}". Expected one of: ${REBUILD_STAGES.join(", ")}.`,
        });
      }
      const stage = parsedStage.data;

      const site = await requireSite(request, reply);
      if (!site) return;

      const body = (request.body ?? {}) as z.infer<typeof StagePayloadSchema>;

      const siteRow = await fastify.db
        .selectFrom("sites")
        .select("tier")
        .where("uuid", "=", site.siteUuid)
        .executeTakeFirst();

      const job = await fastify.queues.pipeline.queue.add(
        "pipeline",
        {
          kind: "stage",
          stage,
          siteUuid: site.siteUuid,
          workspaceUuid: site.workspaceUuid,
          input: {
            ...body,
            tier: body.tier ?? siteRow?.tier ?? "paid",
          },
        },
      );

      return reply.code(202).send({ jobId: job.id ?? "", stage, queue: "pipeline" });
    },
  );

  fastify.post(
    "/sites/:uuid/pipeline/run",
    {
      schema: {
        operationId: "runPipeline",
        tags: ["Pipeline"],
        summary: "Enqueue a full pipeline run (all five stages)",
        params: z.object({ uuid: z.string().uuid() }),
        body: PipelineRunBodySchema,
        response: {
          202: RunEnqueueResponseSchema.extend({ queue: z.literal("pipeline") }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const site = await requireSite(request, reply);
      if (!site) return;

      const siteRow = await fastify.db
        .selectFrom("sites")
        .select("tier")
        .where("uuid", "=", site.siteUuid)
        .executeTakeFirst();

      const job = await fastify.queues.pipeline.queue.add(
        "pipeline",
        {
          kind: "run",
          siteUuid: site.siteUuid,
          workspaceUuid: site.workspaceUuid,
          input: {
            ...request.body,
            tier: request.body.tier ?? siteRow?.tier ?? "paid",
          },
        },
      );

      return reply.code(202).send({ jobId: job.id ?? "", queue: "pipeline" });
    },
  );

  fastify.get(
    "/sites/:uuid/pipeline/status",
    {
      schema: {
        operationId: "pipelineStatus",
        tags: ["Pipeline"],
        summary: "Report per-stage artifact versions and staleness",
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: StatusResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const site = await requireSite(request, reply);
      if (!site) return;

      const ctx: ArtifactContext = {
        siteUuid: site.siteUuid,
        workspaceUuid: site.workspaceUuid,
      };

      const [extract, segment, contract, docgen, build, verify] = await Promise.all([
        loadStageSummary(fastify.db, ctx, "extract"),
        loadStageSummary(fastify.db, ctx, "segment"),
        loadStageSummary(fastify.db, ctx, "contract"),
        loadStageSummary(fastify.db, ctx, "docgen"),
        loadStageSummary(fastify.db, ctx, "build"),
        loadStageSummary(fastify.db, ctx, "verify"),
      ]);

      const segmentStale = isStale(segment, extract, (p) => {
        const value = (p as { sourceExtractAt?: unknown }).sourceExtractAt;
        return typeof value === "string" ? value : undefined;
      });
      const contractStale = isStale(contract, segment);
      // Docgen has no explicit source ref, so fall back to createdAt vs segment.
      const docgenStale = isStale(docgen, contract);
      const buildStale = isStale(build, docgen);
      const verifyStale = isStale(verify, build);

      const format = (
        s: StageSummary | null,
        stale: boolean,
      ): z.infer<typeof StageStatusSchema> =>
        s === null
          ? null
          : {
              version: s.version,
              createdAt: s.createdAt.toISOString(),
              stale,
            };

      const scores =
        verify &&
        typeof (verify.payload as { scores?: unknown }).scores === "object" &&
        (verify.payload as { scores?: unknown }).scores !== null
          ? (() => {
              const sc = (
                verify.payload as {
                  scores: {
                    mechanicalFidelity?: number;
                    visualFidelity?: number;
                    masterFidelity?: number;
                  };
                }
              ).scores;
              if (
                typeof sc.mechanicalFidelity === "number" &&
                typeof sc.visualFidelity === "number" &&
                typeof sc.masterFidelity === "number"
              ) {
                return {
                  mechanicalFidelity: sc.mechanicalFidelity,
                  visualFidelity: sc.visualFidelity,
                  masterFidelity: sc.masterFidelity,
                };
              }
              return null;
            })()
          : null;

      return reply.code(200).send({
        stages: {
          extract: format(extract, false),
          segment: format(segment, segmentStale),
          contract: format(contract, contractStale),
          docgen: format(docgen, docgenStale),
          build: format(build, buildStale),
          verify: format(verify, verifyStale),
        },
        scores,
      });
    },
  );

  fastify.get(
    "/sites/:uuid/pipeline/artifacts/:stage",
    {
      schema: {
        operationId: "getPipelineArtifact",
        tags: ["Pipeline"],
        summary: "Get the latest artifact payload for a pipeline stage",
        params: z.object({
          uuid: z.string().uuid(),
          stage: z.string(),
        }),
        response: {
          200: ArtifactResponseSchema,
          400: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const parsedStage = StageEnum.safeParse(request.params.stage);
      if (!parsedStage.success) {
        return reply.code(400).send({
          error: `Unknown stage "${request.params.stage}". Expected one of: ${REBUILD_STAGES.join(", ")}.`,
        });
      }
      const stage = parsedStage.data;

      const site = await requireSite(request, reply);
      if (!site) return;

      const ctx: ArtifactContext = {
        siteUuid: site.siteUuid,
        workspaceUuid: site.workspaceUuid,
      };
      const stored = await loadArtifact(fastify.db, ctx, stage);
      if (!stored) {
        return reply.code(404).send({ error: "Artifact not found" });
      }
      return reply.code(200).send({
        version: stored.version,
        createdAt: stored.createdAt.toISOString(),
        payload: stored.payload,
      });
    },
  );

  function buildPipelineOptionsResponse() {
    const modeOptions = ModeEnum.options.map((value) => ({
      label: value,
      value,
    }));
    const tierOptions = TierEnum.options.map((value) => ({
      label: value === "free" ? "Free (20 pages, no UGC)" : "Paid (full site)",
      value,
    }));
    const fields = [
      {
        key: "url",
        label: "Source URL",
        type: "text" as const,
        required: true,
        hint: "URL to extract from",
      },
      {
        key: "tier",
        label: "Tier",
        type: "select" as const,
        required: false,
        options: tierOptions,
        hint: "Free caps at 20 pages and skips blogs/events/etc. Paid has no limits.",
      },
      {
        key: "pages",
        label: "Pages",
        type: "multiselect" as const,
        required: false,
        hint: "Leave empty to run all discovered pages",
      },
      {
        key: "mode",
        label: "Mode",
        type: "select" as const,
        required: false,
        options: modeOptions,
        hint: "Pipeline generation mode",
      },
      {
        key: "contentSiteUuid",
        label: "Content source site",
        type: "uuid" as const,
        required: false,
        dependsOn: { key: "mode", value: "template" },
        hint: "Site to pull content from in template mode",
      },
      {
        key: "designSiteUuid",
        label: "Design source site",
        type: "uuid" as const,
        required: false,
        dependsOn: { key: "mode", value: "template" },
        hint: "Site to pull design from in template mode",
      },
    ];
    return {
      stages: [...REBUILD_STAGES],
      modes: ModeEnum.options,
      fields,
    };
  }

  fastify.get(
    "/pipeline/options",
    {
      schema: {
        operationId: "getGlobalPipelineOptions",
        tags: ["Pipeline"],
        summary: "List configurable pipeline options for the new-site run screen",
        response: {
          200: PipelineOptionsResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      return reply.code(200).send(buildPipelineOptionsResponse());
    },
  );

  fastify.get(
    "/sites/:uuid/pipeline/options",
    {
      schema: {
        operationId: "getPipelineOptions",
        tags: ["Pipeline"],
        summary: "List configurable pipeline options for the run screen",
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: PipelineOptionsResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const site = await requireSite(request, reply);
      if (!site) return;

      return reply.code(200).send(buildPipelineOptionsResponse());
    },
  );

  done();
};

export default app;
