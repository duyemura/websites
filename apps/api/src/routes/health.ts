import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const health: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({ status: z.literal("ok") }),
        },
      },
    },
    () => ({ status: "ok" } as const),
  );

  done();
};

export default health;
