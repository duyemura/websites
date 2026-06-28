import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const TemplateSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  category: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  isSystem: z.boolean(),
  tags: z.array(z.string()).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/templates",
    {
      schema: {
        querystring: z.object({ systemOnly: z.enum(["true", "false"]).optional() }),
        response: { 200: z.array(TemplateSchema) },
      },
    },
    async (request) => {
      const workspaceUuid = request.workspace.uuid;
      const systemOnly = request.query.systemOnly === "true";

      let query = fastify.db
        .selectFrom("templates")
        .selectAll()
        .where((eb) =>
          eb.or([
            eb("workspaceUuid", "=", workspaceUuid),
            eb("isSystem", "=", true),
          ]),
        )
        .orderBy("isSystem", "desc")
        .orderBy("name");

      if (systemOnly) {
        query = query.where("isSystem", "=", true);
      }

      const templates = await query.execute();

      return templates.map((template) => ({
        ...template,
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      }));
    },
  );

  done();
};

export default app;
