import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import type { ExpressionBuilder } from "kysely";
import type { DB } from "../../types/db";
import { makeDocKey } from "../../utils/docs";
import { AllowedDocKeySchema, ALLOWED_DOC_KEYS } from "../../utils/doc-registry";

const DocSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  siteUuid: z.string().nullable().optional(),
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
  siteUuid: z.string().uuid().optional(),
});

const DocKeyParamsSchema = z.object({
  key: AllowedDocKeySchema,
});

const DocKeyQuerySchema = z.object({
  siteUuid: z.string().uuid().optional(),
});

/**
 * Adds the site-scoped filter to a docs query. When siteUuid is provided the
 * doc must belong to that site; when omitted the doc must be workspace-scoped
 * (site_uuid IS NULL).
 */
function filterBySiteUuid(
  eb: ExpressionBuilder<DB, "docs">,
  siteUuid: string | undefined,
) {
  return siteUuid
    ? eb("siteUuid", "=", siteUuid)
    : eb("siteUuid", "is", null);
}

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
        params: DocKeyParamsSchema,
        querystring: DocKeyQuerySchema,
        response: { 200: DocSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { siteUuid } = request.query;
      const doc = await fastify.db
        .selectFrom("docs")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", key)
        .where((eb) => filterBySiteUuid(eb, siteUuid))
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
        params: DocKeyParamsSchema,
        querystring: DocKeyQuerySchema,
        body: UpsertDocSchema,
        response: { 200: DocSchema, 201: DocSchema, 400: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { title, content } = request.body;
      const workspaceUuid = request.workspace.uuid;
      const { key } = request.params;
      const { siteUuid } = request.query;

      const existing = await fastify.db
        .selectFrom("docs")
        .select("uuid")
        .where("workspaceUuid", "=", workspaceUuid)
        .where("key", "=", key)
        .where((eb) => filterBySiteUuid(eb, siteUuid))
        .executeTakeFirst();

      if (existing) {
        const updated = await fastify.db
          .updateTable("docs")
          .set({ title, content, updatedAt: new Date() })
          .where("uuid", "=", existing.uuid)
          .returningAll()
          .executeTakeFirstOrThrow();

        return reply.code(200).send({
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        });
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
          siteUuid: siteUuid ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return reply.code(201).send({
        ...created,
        createdAt: created.createdAt.toISOString(),
        updatedAt: created.updatedAt.toISOString(),
      });
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
      const { title, content, siteUuid } = request.body;
      const generatedKey = makeDocKey(title, request.body.key);
      const keyParse = AllowedDocKeySchema.safeParse(generatedKey);
      if (!keyParse.success) {
        return reply.code(400).send({
          error:
            `Doc key "${generatedKey}" is not allowed. ` +
            `Allowed keys: ${ALLOWED_DOC_KEYS.join(", ")}.`,
        });
      }
      const key = keyParse.data;
      const workspaceUuid = request.workspace.uuid;

      const existing = await fastify.db
        .selectFrom("docs")
        .select("uuid")
        .where("workspaceUuid", "=", workspaceUuid)
        .where("key", "=", key)
        .where((eb) => filterBySiteUuid(eb, siteUuid))
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
          siteUuid: siteUuid ?? null,
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
        params: DocKeyParamsSchema,
        querystring: DocKeyQuerySchema,
        response: { 204: z.object({}).openapi({ type: "object" }) },
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { siteUuid } = request.query;
      await fastify.db
        .deleteFrom("docs")
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", key)
        .where((eb) => filterBySiteUuid(eb, siteUuid))
        .execute();

      return reply.code(204).send({});
    },
  );

  fastify.post(
    "/docs/:key/archive",
    {
      schema: {
        params: DocKeyParamsSchema,
        querystring: DocKeyQuerySchema,
        response: { 200: DocSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { siteUuid } = request.query;
      const updated = await fastify.db
        .updateTable("docs")
        .set({ status: "archived", updatedAt: new Date() })
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", key)
        .where((eb) => filterBySiteUuid(eb, siteUuid))
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
        params: DocKeyParamsSchema,
        querystring: DocKeyQuerySchema,
        response: { 200: DocSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { key } = request.params;
      const { siteUuid } = request.query;
      const updated = await fastify.db
        .updateTable("docs")
        .set({ status: "active", updatedAt: new Date() })
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("key", "=", key)
        .where((eb) => filterBySiteUuid(eb, siteUuid))
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
