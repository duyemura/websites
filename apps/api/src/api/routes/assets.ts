import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

const AssetType = z.enum(["image", "video", "font", "document", "logo", "icon"]);
const AssetSource = z.enum(["upload", "scraped", "screenshot", "ai_generated"]);

const AssetAnalysisSchema = z.object({
  analyzedAt: z.string(),
  model: z.string(),
  version: z.number().int(),
  description: z.string(),
  altText: z.string(),
  context: z.string(),
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string()),
  technical: z.object({
    hasText: z.boolean(),
    textConfidence: z.number().min(0).max(1),
    faces: z.number().int().nullable().optional(),
    people: z.number().int().nullable().optional(),
  }),
  quality: z.object({
    score: z.number().int().min(1).max(5),
    resolution: z.enum(["low", "medium", "high", "unknown"]),
    sharpness: z.enum(["blurry", "soft", "good", "sharp", "unknown"]),
    issues: z.array(z.string()),
  }),
  marketing: z.object({
    mood: z.string(),
    useCases: z.array(z.string()),
    subject: z.string(),
    brandFit: z.number().min(0).max(1).nullable().optional(),
  }),
  safety: z.object({
    hasIdentifiablePeople: z.boolean(),
    needsReview: z.boolean(),
  }),
});

const AssetMetadataSchema = z.object({
  filename: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  size: z.number().int().optional(),
  dimensions: z
    .object({
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  analysis: AssetAnalysisSchema.optional(),
});

const AssetSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  name: z.string(),
  type: AssetType,
  source: AssetSource,
  mimeType: z.string().nullable().optional(),
  url: z.string(),
  signedUrl: z.string(),
  storageKey: z.string(),
  metadata: AssetMetadataSchema.nullable().optional(),
  createdAt: z.string(),
});

const CreateAssetSchema = z.object({
  name: z.string().min(1),
  type: AssetType,
  source: AssetSource.default("upload"),
  mimeType: z.string().optional(),
  url: z.string().url(),
  storageKey: z.string().min(1),
  metadata: AssetMetadataSchema.optional(),
});

const UpdateAssetSchema = z.object({
  name: z.string().min(1).optional(),
  type: AssetType.optional(),
  metadata: AssetMetadataSchema.optional(),
});

function storageKeyBelongsToWorkspace(
  storageKey: string,
  workspaceUuid: string,
): boolean {
  return storageKey.startsWith(`workspaces/${workspaceUuid}/`);
}

function enqueueAssetClassification(
  fastify: FastifyInstance,
  workspaceUuid: string,
  assetUuid: string,
  userUuid: string,
  source: string,
  type: string,
  siteUuid?: string,
) {
  if (source === "screenshot") return;
  if (type !== "image") return;

  fastify.queues.classifyAssets.queue
    .add("classify_assets", {
      workspaceUuid,
      assetUuid,
      userUuid,
      siteUuid,
    })
    .catch((err) => {
      fastify.log.warn({ err, assetUuid }, "Failed to enqueue asset classification");
    });
}

function serializeAsset(
  asset: {
    uuid: string;
    workspaceUuid: string;
    name: string;
    type: string;
    source: string;
    mimeType: string | null;
    url: string;
    storageKey: string;
    metadata: unknown;
    createdAt: Date;
  },
  signedUrl: string,
) {
  return {
    uuid: asset.uuid,
    workspaceUuid: asset.workspaceUuid,
    name: asset.name,
    type: AssetType.parse(asset.type),
    source: AssetSource.parse(asset.source),
    mimeType: asset.mimeType,
    url: asset.url,
    signedUrl,
    storageKey: asset.storageKey,
    metadata: asset.metadata
      ? AssetMetadataSchema.parse(asset.metadata)
      : null,
    createdAt: asset.createdAt.toISOString(),
  };
}

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/assets",
    {
      schema: {
        querystring: z.object({
          tag: z.string().optional(),
          source: AssetSource.optional(),
          analyzed: z.enum(["true", "false"]).optional(),
        }),
        response: { 200: z.array(AssetSchema) },
      },
    },
    async (request) => {
      let query = fastify.db
        .selectFrom("assets")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("source", "!=", "screenshot");

      if (request.query.source) {
        query = query.where("source", "=", request.query.source);
      }
      if (request.query.tag) {
        query = query.where(
          "metadata",
          "@>",
          JSON.stringify({ analysis: { tags: [request.query.tag] } }),
        );
      }
      if (request.query.analyzed === "true") {
        query = query.where("metadata", "@>", JSON.stringify({ analysis: {} }));
      } else if (request.query.analyzed === "false") {
        query = query.where((eb) =>
          eb.or([
            eb("metadata", "is", null),
            eb.not(eb("metadata", "@>", JSON.stringify({ analysis: {} }))),
          ]),
        );
      }

      const assets = await query.orderBy("createdAt", "desc").execute();

      return Promise.all(
        assets.map(async (asset) =>
          serializeAsset(
            asset,
            await fastify.storage.getDownloadUrl(asset.storageKey),
          ),
        ),
      );
    },
  );

  fastify.get(
    "/assets/:uuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 200: AssetSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const asset = await fastify.db
        .selectFrom("assets")
        .selectAll()
        .where("uuid", "=", request.params.uuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!asset) {
        return reply.code(404).send({ error: "Asset not found" });
      }

      return serializeAsset(
        asset,
        await fastify.storage.getDownloadUrl(asset.storageKey),
      );
    },
  );

  fastify.get(
    "/assets/:uuid/raw",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: z.any().openapi({ format: "binary", type: "string" }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const asset = await fastify.db
        .selectFrom("assets")
        .select(["storageKey", "mimeType"])
        .where("uuid", "=", request.params.uuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!asset) {
        return reply.code(404).send({ error: "Asset not found" });
      }

      const stream = await fastify.storage.getObjectStream(asset.storageKey);
      return reply.type(asset.mimeType ?? "application/octet-stream").send(stream);
    },
  );

  fastify.post(
    "/assets",
    {
      schema: {
        body: CreateAssetSchema,
        response: { 201: AssetSchema, 400: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      if (
        !storageKeyBelongsToWorkspace(
          request.body.storageKey,
          request.workspace.uuid,
        )
      ) {
        return reply.code(400).send({ error: "Invalid storage key" });
      }

      const asset = await fastify.db
        .insertInto("assets")
        .values({
          workspaceUuid: request.workspace.uuid,
          ...request.body,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      enqueueAssetClassification(
        fastify,
        asset.workspaceUuid,
        asset.uuid,
        request.user.uuid,
        asset.source,
        asset.type,
      );

      return reply.code(201).send(
        serializeAsset(
          asset,
          await fastify.storage.getDownloadUrl(asset.storageKey),
        ),
      );
    },
  );

  fastify.put(
    "/assets/:uuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        body: UpdateAssetSchema,
        response: { 200: AssetSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const update = request.body;
      const asset = await fastify.db
        .updateTable("assets")
        .set(update)
        .where("uuid", "=", request.params.uuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .returningAll()
        .executeTakeFirst();

      if (!asset) {
        return reply.code(404).send({ error: "Asset not found" });
      }

      return serializeAsset(
        asset,
        await fastify.storage.getDownloadUrl(asset.storageKey),
      );
    },
  );

  fastify.delete(
    "/assets/:uuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          204: z.object({}).openapi({ type: "object" }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const asset = await fastify.db
        .selectFrom("assets")
        .select("storageKey")
        .where("uuid", "=", request.params.uuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!asset) {
        return reply.code(404).send({ error: "Asset not found" });
      }

      await fastify.storage.deleteObject(asset.storageKey);
      await fastify.db
        .deleteFrom("assets")
        .where("uuid", "=", request.params.uuid)
        .execute();

      return reply.code(204).send({});
    },
  );

  fastify.post(
    "/assets/backfill-analysis",
    {
      schema: {
        response: { 202: z.object({ enqueued: z.number().int() }) },
      },
    },
    async (request, reply) => {
      const assets = await fastify.db
        .selectFrom("assets")
        .select(["uuid"])
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("source", "!=", "screenshot")
        .where("type", "=", "image")
        .where((eb) =>
          eb.or([
            eb("metadata", "is", null),
            eb.not(eb("metadata", "@>", JSON.stringify({ analysis: {} }))),
          ]),
        )
        .execute();

      for (const asset of assets) {
        fastify.queues.classifyAssets.queue
          .add("classify_assets", {
            workspaceUuid: request.workspace.uuid,
            assetUuid: asset.uuid,
            userUuid: request.user.uuid,
          })
          .catch((err) => {
            fastify.log.warn(
              { err, assetUuid: asset.uuid },
              "Failed to enqueue backfill asset classification",
            );
          });
      }

      return reply.code(202).send({ enqueued: assets.length });
    },
  );

  fastify.post(
    "/assets/:uuid/regenerate-analysis",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 202: z.object({ enqueued: z.boolean() }), 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const asset = await fastify.db
        .selectFrom("assets")
        .select(["uuid", "source", "type"])
        .where("uuid", "=", request.params.uuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!asset) {
        return reply.code(404).send({ error: "Asset not found" });
      }

      if (asset.source === "screenshot" || asset.type !== "image") {
        return reply.code(202).send({ enqueued: false });
      }

      await fastify.queues.classifyAssets.queue.add("classify_assets", {
        workspaceUuid: request.workspace.uuid,
        assetUuid: asset.uuid,
        userUuid: request.user.uuid,
      });

      return reply.code(202).send({ enqueued: true });
    },
  );

  done();
};

export default app;
