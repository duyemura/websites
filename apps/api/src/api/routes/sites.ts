import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { sql } from "kysely";

const SiteSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  themeUuid: z.string().nullable().optional(),
  defaultMetaTitle: z.string().nullable().optional(),
  defaultMetaDescription: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateSiteSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  templateKey: z.string().optional(),
});

const app: FastifyPluginCallbackZodOpenApi = (fastify, _, done) => {
  fastify.get(
    "/sites",
    {
      schema: {
        response: { 200: z.array(SiteSchema) },
      },
    },
    async (request) => {
      const sites = await fastify.db
        .selectFrom("sites")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .orderBy("createdAt", "desc")
        .execute();

      return sites.map((site) => ({
        ...site,
        createdAt: site.createdAt.toISOString(),
        updatedAt: site.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/sites",
    {
      schema: {
        body: CreateSiteSchema,
        response: { 201: SiteSchema, 409: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { name, slug, templateKey } = request.body;
      const workspaceUuid = request.workspace.uuid;

      const existing = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("workspaceUuid", "=", workspaceUuid)
        .where("slug", "=", slug)
        .executeTakeFirst();

      if (existing) {
        return reply.code(409).send({ error: "Site slug already exists in this workspace" });
      }

      let themeUuid: string | null = null;
      let homepageSections: unknown[] = [];

      if (templateKey) {
        const template = await fastify.db
          .selectFrom("templates")
          .select(["theme", "page"])
          .where("key", "=", templateKey)
          .where((eb) =>
            eb.or([
              eb("workspaceUuid", "=", workspaceUuid),
              eb("isSystem", "=", true),
            ]),
          )
          .executeTakeFirst();

        if (template?.theme) {
          const theme = await fastify.db
            .insertInto("themes")
            .values({
              workspaceUuid,
              name: `${name} theme`,
              source: "system_preset",
              templateKey,
              tokens: template.theme as never,
            })
            .returning("uuid")
            .executeTakeFirstOrThrow();
          themeUuid = theme.uuid;
        }

        if (template?.page && typeof template.page === "object") {
          const page = template.page as Record<string, unknown>;
          homepageSections = Array.isArray(page.sections) ? page.sections : [];
        }
      }

      const site = await fastify.db
        .insertInto("sites")
        .values({
          workspaceUuid,
          name,
          slug,
          status: "draft",
          themeUuid,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await fastify.db
        .insertInto("pages")
        .values({
          siteUuid: site.uuid,
          title: "Home",
          slug: "index",
          isHomePage: true,
          sections: sql`${JSON.stringify(homepageSections)}::jsonb`,
          status: "draft",
        })
        .execute();

      return reply.code(201).send({
        ...site,
        createdAt: site.createdAt.toISOString(),
        updatedAt: site.updatedAt.toISOString(),
      });
    },
  );

  done();
};

export default app;
