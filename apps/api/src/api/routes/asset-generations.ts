import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AssetGenerationUseCaseSchema,
  OutputSpecSchema,
} from "../../ai/prompts/asset-generation";
import {
  createAssetGeneration,
  deleteAssetGeneration,
  getAssetGeneration,
  retryAssetGeneration,
} from "../../services/asset-generation";

const AssetGenerationStatus = z.enum([
  "pending",
  "generating",
  "uploaded",
  "analyzing",
  "ready",
  "failed",
]);

const AssetGenerationSchema = z.object({
  uuid: z.string().uuid(),
  workspaceUuid: z.string().uuid(),
  siteUuid: z.string().uuid().nullable(),
  userUuid: z.string(),
  useCase: AssetGenerationUseCaseSchema,
  subject: z.string(),
  referenceAssetUuids: z.array(z.string().uuid()).nullable(),
  outputSpec: OutputSpecSchema,
  status: AssetGenerationStatus,
  generatedAssetUuid: z.string().uuid().nullable(),
  failureReason: z.string().nullable(),
  costUsd: z.number().nullable(),
  retries: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateAssetGenerationSchema = z.object({
  workspaceUuid: z.string().uuid(),
  siteUuid: z.string().uuid().optional(),
  useCase: AssetGenerationUseCaseSchema,
  subject: z.string().min(1).max(600),
  referenceAssetUuids: z.array(z.string().uuid()).max(4).optional(),
  outputSpec: OutputSpecSchema.default({}),
});

function canGenerateImages(request: FastifyRequest): boolean {
  // Until cost caps and workspace settings exist, restrict generation to
  // workspace owners and admins.
  return ["owner", "admin"].includes(request.membership.role);
}

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/asset-generations",
    {
      schema: {
        operationId: "listAssetGenerations",
        tags: ["asset-generations"],
        summary: "List asset generations for the workspace",
        querystring: z.object({
          siteUuid: z.string().uuid().optional(),
        }),
        response: { 200: z.array(AssetGenerationSchema) },
      },
    },
    async (request) => {
      let query = fastify.db
        .selectFrom("assetGenerations")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .orderBy("createdAt", "desc");

      if (request.query.siteUuid) {
        query = query.where("siteUuid", "=", request.query.siteUuid);
      }

      const rows = await query.execute();
      return rows.map((row) => ({
        uuid: row.uuid,
        workspaceUuid: row.workspaceUuid,
        siteUuid: row.siteUuid,
        userUuid: row.userUuid,
        useCase: row.useCase,
        subject: row.subject,
        referenceAssetUuids: (row.referenceAssetUuids as string[] | null) ?? null,
        outputSpec: row.outputSpec as z.infer<typeof OutputSpecSchema>,
        status: row.status,
        generatedAssetUuid: row.generatedAssetUuid,
        failureReason: row.failureReason,
        costUsd: row.costUsd ? Number(row.costUsd) : null,
        retries: row.retries,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
  );

  fastify.get(
    "/asset-generations/:uuid",
    {
      schema: {
        operationId: "getAssetGeneration",
        tags: ["asset-generations"],
        summary: "Get a single asset generation by UUID",
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: AssetGenerationSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const row = await fastify.db
        .selectFrom("assetGenerations")
        .selectAll()
        .where("uuid", "=", request.params.uuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!row) {
        return reply.code(404).send({ error: "Asset generation not found" });
      }

      return {
        uuid: row.uuid,
        workspaceUuid: row.workspaceUuid,
        siteUuid: row.siteUuid,
        userUuid: row.userUuid,
        useCase: row.useCase,
        subject: row.subject,
        referenceAssetUuids: (row.referenceAssetUuids as string[] | null) ?? null,
        outputSpec: row.outputSpec as z.infer<typeof OutputSpecSchema>,
        status: row.status,
        generatedAssetUuid: row.generatedAssetUuid,
        failureReason: row.failureReason,
        costUsd: row.costUsd ? Number(row.costUsd) : null,
        retries: row.retries,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/asset-generations",
    {
      schema: {
        operationId: "createAssetGeneration",
        tags: ["asset-generations"],
        summary: "Create a new AI image generation job",
        body: CreateAssetGenerationSchema,
        response: {
          202: z.object({ uuid: z.string().uuid(), status: z.string() }),
          400: z.object({ error: z.string() }),
          403: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      if (!canGenerateImages(request)) {
        return reply
          .code(403)
          .send({ error: "Image generation requires owner or admin access" });
      }

      if (request.body.workspaceUuid !== request.workspace.uuid) {
        return reply
          .code(400)
          .send({ error: "workspaceUuid does not match authenticated workspace" });
      }

      const { uuid } = await createAssetGeneration(fastify.db, {
        workspaceUuid: request.workspace.uuid,
        siteUuid: request.body.siteUuid,
        userUuid: request.user.uuid,
        useCase: request.body.useCase,
        subject: request.body.subject,
        referenceAssetUuids: request.body.referenceAssetUuids,
        outputSpec: request.body.outputSpec,
      });

      await fastify.queues.generateAssets.queue.add(
        "generate_assets",
        {
          workspaceUuid: request.workspace.uuid,
          siteUuid: request.body.siteUuid,
          assetGenerationUuid: uuid,
          userUuid: request.user.uuid,
        },
        { jobId: uuid },
      );

      return reply.code(202).send({ uuid, status: "pending" });
    },
  );

  fastify.post(
    "/asset-generations/:uuid/retry",
    {
      schema: {
        operationId: "retryAssetGeneration",
        tags: ["asset-generations"],
        summary: "Retry a failed asset generation",
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          202: z.object({ uuid: z.string().uuid(), status: z.string() }),
          400: z.object({ error: z.string() }),
          404: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const row = await getAssetGeneration(fastify.db, request.params.uuid);
      if (!row || row.workspaceUuid !== (request.workspace.uuid as unknown as string)) {
        return reply.code(404).send({ error: "Asset generation not found" });
      }

      if ((row.status as unknown as string) !== "failed") {
        return reply
          .code(409)
          .send({ error: "Only failed generations can be retried" });
      }

      await retryAssetGeneration(fastify.db, request.params.uuid);

      const jobId = row.uuid as unknown as string;
      const existingJob = await fastify.queues.generateAssets.queue.getJob(jobId);
      if (existingJob) {
        await existingJob.remove();
      }

      await fastify.queues.generateAssets.queue.add(
        "generate_assets",
        {
          workspaceUuid: row.workspaceUuid as unknown as string,
          siteUuid: row.siteUuid,
          assetGenerationUuid: row.uuid as unknown as string,
          userUuid: request.user.uuid,
        },
        { jobId },
      );

      return reply.code(202).send({ uuid: row.uuid as unknown as string, status: "pending" });
    },
  );

  fastify.delete(
    "/asset-generations/:uuid",
    {
      schema: {
        operationId: "deleteAssetGeneration",
        tags: ["asset-generations"],
        summary: "Delete an asset generation",
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          204: z.object({}).openapi({ type: "object" }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const row = await getAssetGeneration(fastify.db, request.params.uuid);
      if (!row || row.workspaceUuid !== request.workspace.uuid) {
        return reply.code(404).send({ error: "Asset generation not found" });
      }

      await deleteAssetGeneration(fastify.db, request.params.uuid);
      return reply.code(204).send({});
    },
  );

  done();
};

export default app;
