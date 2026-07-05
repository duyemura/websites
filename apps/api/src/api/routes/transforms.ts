import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { sql } from "kysely";
import { jsonb } from "../../utils/jsonb";
import { CreateTransformSchema, UpdateTransformSchema } from "../../utils/mirror/transform-schemas";

const Params = z.object({ siteUuid: z.string().uuid() });
const ParamsWithId = Params.extend({ transformUuid: z.string().uuid() });
const ErrorSchema = z.object({ error: z.string() });

const TransformSchema = z.object({
  uuid: z.string().uuid(),
  siteUuid: z.string().uuid(),
  workspaceUuid: z.string().uuid(),
  ordinal: z.number(),
  type: z.string(),
  pageGlob: z.string(),
  selector: z.string().nullable(),
  payload: z.unknown(),
  author: z.string(),
  status: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  async function ownedSite(siteUuid: string, workspaceUuid: string) {
    return fastify.db
      .selectFrom("sites")
      .select("uuid")
      .where("uuid", "=", siteUuid)
      .where("workspaceUuid", "=", workspaceUuid)
      .executeTakeFirst();
  }

  // ---------------------------------------------------------------------------
  // POST /sites/:siteUuid/transforms — create a transform
  // ---------------------------------------------------------------------------
  fastify.post(
    "/sites/:siteUuid/transforms",
    {
      schema: {
        params: Params,
        body: CreateTransformSchema,
        response: {
          201: z.object({ uuid: z.string().uuid(), ordinal: z.number() }),
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const body = request.body;
      const selector =
        "selector" in body && typeof body.selector === "string" ? body.selector : null;

      // C1: compute ordinal atomically as a subselect inside the INSERT so two
      // concurrent requests can't both read the same max and produce duplicates.
      const row = await fastify.db
        .insertInto("siteTransforms")
        .values({
          siteUuid,
          workspaceUuid: request.workspace.uuid,
          ordinal: sql<number>`(select coalesce(max(ordinal), 0) + 1 from site_transforms where site_uuid = ${siteUuid})`,
          type: body.type,
          pageGlob: body.pageGlob,
          selector,
          payload: jsonb(body.payload),
          author: body.author,
        })
        .returning(["uuid", "ordinal"])
        .executeTakeFirstOrThrow();

      return reply.code(201).send(row);
    },
  );

  // ---------------------------------------------------------------------------
  // GET /sites/:siteUuid/transforms — list transforms ordered by ordinal
  // ---------------------------------------------------------------------------
  fastify.get(
    "/sites/:siteUuid/transforms",
    {
      schema: {
        params: Params,
        response: { 200: z.array(TransformSchema), 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      const { siteUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) {
        return reply.code(404).send({ error: "Site not found" });
      }
      return fastify.db
        .selectFrom("siteTransforms")
        .selectAll()
        .where("siteUuid", "=", siteUuid)
        .orderBy("ordinal", "asc")
        .execute();
    },
  );

  // ---------------------------------------------------------------------------
  // PATCH /sites/:siteUuid/transforms/:transformUuid — update status or ordinal
  // ---------------------------------------------------------------------------
  fastify.patch(
    "/sites/:siteUuid/transforms/:transformUuid",
    {
      schema: {
        params: ParamsWithId,
        body: UpdateTransformSchema,
        response: {
          200: z.object({ ok: z.boolean() }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid, transformUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) {
        return reply.code(404).send({ error: "Site not found" });
      }
      // C2: return 404 if the transform doesn't exist or doesn't belong to this site
      const result = await fastify.db
        .updateTable("siteTransforms")
        .set({ ...request.body, updatedAt: new Date() })
        .where("uuid", "=", transformUuid)
        .where("siteUuid", "=", siteUuid)
        .executeTakeFirst();
      if (result.numUpdatedRows === 0n) {
        return reply.code(404).send({ error: "Transform not found" });
      }
      return { ok: true };
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /sites/:siteUuid/transforms/:transformUuid — remove a transform
  // ---------------------------------------------------------------------------
  fastify.delete(
    "/sites/:siteUuid/transforms/:transformUuid",
    {
      schema: {
        params: ParamsWithId,
        response: {
          200: z.object({ ok: z.boolean() }),
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { siteUuid, transformUuid } = request.params;
      if (!(await ownedSite(siteUuid, request.workspace.uuid))) {
        return reply.code(404).send({ error: "Site not found" });
      }
      // C2: return 404 if the transform doesn't exist or doesn't belong to this site
      const result = await fastify.db
        .deleteFrom("siteTransforms")
        .where("uuid", "=", transformUuid)
        .where("siteUuid", "=", siteUuid)
        .executeTakeFirst();
      if (result.numDeletedRows === 0n) {
        return reply.code(404).send({ error: "Transform not found" });
      }
      return { ok: true };
    },
  );

  done();
};

export default app;
