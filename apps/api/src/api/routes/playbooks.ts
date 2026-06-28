import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const PlaybookSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  isSystem: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/playbooks",
    {
      schema: {
        response: { 200: z.array(PlaybookSchema) },
      },
    },
    async (request) => {
      const workspaceUuid = request.workspace.uuid;

      const playbooks = await fastify.db
        .selectFrom("playbooks")
        .selectAll()
        .where((eb) =>
          eb.or([
            eb("workspaceUuid", "=", workspaceUuid),
            eb("isSystem", "=", true),
          ]),
        )
        .orderBy("isSystem", "desc")
        .orderBy("name")
        .execute();

      return playbooks.map((playbook) => ({
        ...playbook,
        createdAt: playbook.createdAt.toISOString(),
        updatedAt: playbook.updatedAt.toISOString(),
      }));
    },
  );

  done();
};

export default app;
