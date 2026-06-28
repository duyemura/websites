import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { makeDocKey } from "../../utils/docs";

const DocSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  key: z.string(),
  title: z.string(),
  content: z.string().nullable().optional(),
  source: z.enum(["manual", "ai_extracted", "imported"]),
  status: z.enum(["active", "archived"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const UpsertDocSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
});

const CreateDocSchema = z.object({
  title: z.string().min(1),
  content: z.string().optional(),
  key: z.string().min(1).max(100).optional(),
});


const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/docs",
    {
      schema: {
        response: { 200: z.array(DocSchema) },
      },
    },
    async (request) => {
      const docs = await fastify.db
        .selectFrom("docs")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("status", "!=", "archived")
        .orderBy("key")
        .execute();

      return docs.map((doc) => ({
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      }));
    },
  );

  fastify.get(
    "/docs/:key",
    {
      schema: {
        params: z.object({ key: z.string() }),
        response: { 200: DocSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const doc = await fastify.db
        .selectFrom("docs")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", request.params.key)
        .executeTakeFirst();

      if (!doc) {
        return reply.code(404).send({ error: "Doc not found" });
      }

      return {
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      };
    },
  );

  fastify.put(
    "/docs/:key",
    {
      schema: {
        params: z.object({ key: z.string() }),
        body: UpsertDocSchema,
        response: { 200: DocSchema },
      },
    },
    async (request) => {
      const { title, content } = request.body;
      const workspaceUuid = request.workspace.uuid;
      const key = request.params.key;

      const existing = await fastify.db
        .selectFrom("docs")
        .select("uuid")
        .where("workspaceUuid", "=", workspaceUuid)
        .where("key", "=", key)
        .executeTakeFirst();

      if (existing) {
        const updated = await fastify.db
          .updateTable("docs")
          .set({ title, content, updatedAt: new Date() })
          .where("uuid", "=", existing.uuid)
          .returningAll()
          .executeTakeFirstOrThrow();

        return {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        };
      }

      const created = await fastify.db
        .insertInto("docs")
        .values({
          workspaceUuid,
          key,
          title,
          content: content ?? "",
          source: "manual",
          status: "active",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/docs",
    {
      schema: {
        body: CreateDocSchema,
        response: {
          200: DocSchema,
          400: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { title, content } = request.body;
      const key = makeDocKey(title, request.body.key);

      if (!key) {
        return reply.code(400).send({ error: "Doc key is required." });
      }

      const workspaceUuid = request.workspace.uuid;

      const existing = await fastify.db
        .selectFrom("docs")
        .select("uuid")
        .where("workspaceUuid", "=", workspaceUuid)
        .where("key", "=", key)
        .executeTakeFirst();

      if (existing) {
        return reply.code(409).send({ error: "A doc with this key already exists." });
      }

      const created = await fastify.db
        .insertInto("docs")
        .values({
          workspaceUuid,
          key,
          title,
          content: content ?? "",
          source: "manual",
          status: "active",
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      };
    },
  );

  fastify.delete(
    "/docs/:key",
    {
      schema: {
        params: z.object({ key: z.string() }),
        response: { 204: z.object({}).openapi({ type: "object" }) },
      },
    },
    async (request, reply) => {
      await fastify.db
        .deleteFrom("docs")
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", request.params.key)
        .execute();

      return reply.code(204).send({});
    },
  );

  fastify.post(
    "/docs/:key/archive",
    {
      schema: {
        params: z.object({ key: z.string() }),
        response: { 200: DocSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const updated = await fastify.db
        .updateTable("docs")
        .set({ status: "archived", updatedAt: new Date() })
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", request.params.key)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        return reply.code(404).send({ error: "Doc not found" });
      }

      return {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  fastify.post(
    "/docs/:key/restore",
    {
      schema: {
        params: z.object({ key: z.string() }),
        response: { 200: DocSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const updated = await fastify.db
        .updateTable("docs")
        .set({ status: "active", updatedAt: new Date() })
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", request.params.key)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        return reply.code(404).send({ error: "Doc not found" });
      }

      return {
        ...updated,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    },
  );

  done();
};

export default app;
