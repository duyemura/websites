import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const AssetType = z.enum(["image", "video", "font", "document", "logo", "icon"]);

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
});

const AssetSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  name: z.string(),
  type: AssetType,
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

function serializeAsset(
  asset: {
    uuid: string;
    workspaceUuid: string;
    name: string;
    type: string;
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
        response: { 200: z.array(AssetSchema) },
      },
    },
    async (request) => {
      const assets = await fastify.db
        .selectFrom("assets")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .orderBy("createdAt", "desc")
        .execute();

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

  done();
};

export default app;
