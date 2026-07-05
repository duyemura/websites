import type { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { listLeads } from "../../services/leads";

const LeadItemSchema = z.object({
  uuid: z.string(),
  formId: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  name: z.string().nullable(),
  sourcePath: z.string().nullable(),
  fields: z.unknown(),
  createdAt: z.string(),
});

const LeadPageSchema = z.object({
  leads: z.array(LeadItemSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
});

const ErrorSchema = z.object({ error: z.string() });

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/workspaces/:workspaceUuid/sites/:siteUuid/leads",
    {
      schema: {
        params: z.object({
          workspaceUuid: z.string().uuid(),
          siteUuid: z.string().uuid(),
        }),
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
          formId: z.string().max(200).optional(),
        }),
        response: {
          200: LeadPageSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { workspaceUuid, siteUuid } = request.params;
      const { page, limit, formId } = request.query;

      // Verify the site belongs to this workspace
      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!site) return reply.code(404).send({ error: "Site not found" });

      const result = await listLeads(fastify.db, { siteUuid, workspaceUuid, page, limit, formId });
      return reply.code(200).send({
        ...result,
        leads: result.leads.map((lead) => ({
          ...lead,
          createdAt: lead.createdAt.toISOString(),
        })),
      });
    },
  );

  done();
};

export default app;
