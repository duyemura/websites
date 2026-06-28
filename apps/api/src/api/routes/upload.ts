import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";

const UploadUrlSchema = z.object({
  signedUrl: z.string(),
  publicUrl: z.string(),
  storageKey: z.string(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/assets/upload-url",
    {
      schema: {
        querystring: z.object({
          filename: z.string().min(1),
          contentType: z.string().optional(),
        }),
        response: { 200: UploadUrlSchema },
      },
    },
    async (request) => {
      return fastify.storage.getUploadUrl(
        request.workspace.uuid,
        request.query.filename,
        request.query.contentType,
      );
    },
  );

  done();
};

export default app;
