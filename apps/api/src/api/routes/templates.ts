import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { chromium } from "playwright";
import path from "node:path";
import os from "node:os";
import { mkdir } from "node:fs/promises";
import { TemplateShellSchema } from "@ploy-gyms/shared-types";
import { scrapeWebsite } from "../../utils/scrape-website";
import { buildTemplateShell } from "../../utils/template-shell";

const TemplateSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string().nullable().optional(),
  key: z.string(),
  name: z.string(),
  category: z.string().nullable().optional(),
  thumbnailUrl: z.string().nullable().optional(),
  isSystem: z.boolean(),
  tags: z.array(z.string()).nullable().optional(),
  theme: TemplateShellSchema.shape.theme,
  page: TemplateShellSchema.shape.page,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateTemplateFromUrlSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1).optional(),
  category: z.string().optional(),
});

function deriveTemplateKey(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const base = hostname.split(".")[0]?.replace(/[^a-z0-9]+/g, "-") ?? "template";
    return `${base.replace(/^-|-$/g, "")}-shell`.toLowerCase() || "template-shell";
  } catch {
    return "template-shell";
  }
}

function deriveTemplateName(url: string, provided?: string): string {
  if (provided?.trim()) return provided.trim();
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const name = hostname.split(".")[0] ?? "Imported template";
    return `${name.charAt(0).toUpperCase() + name.slice(1)} template`;
  } catch {
    return "Imported template";
  }
}

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
        theme: template.theme as z.infer<typeof TemplateSchema>["theme"],
        page: template.page as z.infer<typeof TemplateSchema>["page"],
        createdAt: template.createdAt.toISOString(),
        updatedAt: template.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/templates/from-url",
    {
      schema: {
        body: CreateTemplateFromUrlSchema,
        response: { 201: TemplateSchema, 400: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const { url, name, category } = request.body;
      const workspaceUuid = request.workspace.uuid;
      const templateKey = deriveTemplateKey(url);

      const existing = await fastify.db
        .selectFrom("templates")
        .select("uuid")
        .where("workspaceUuid", "=", workspaceUuid)
        .where("key", "=", templateKey)
        .executeTakeFirst();

      if (existing) {
        return reply
          .code(400)
          .send({ error: "A template for this URL already exists in this workspace." });
      }

      let browser;
      try {
        browser = await chromium.launch({ headless: true });
        const tmpDir = path.join(os.tmpdir(), "ploy-gyms-template-shells");
        await mkdir(tmpDir, { recursive: true });
        const screenshotPath = path.join(tmpDir, `template-shell-${Date.now()}.png`);

        const data = await scrapeWebsite(browser, {
          url,
          takeScreenshot: true,
          screenshotPath,
          captureHtml: false,
        });

        const shell = buildTemplateShell(data);

        const template = await fastify.db
          .insertInto("templates")
          .values({
            workspaceUuid,
            key: templateKey,
            name: deriveTemplateName(url, name),
            category: category ?? "Imported",
            isSystem: false,
            tags: ["imported", "url-template", "shell"],
            theme: shell.theme as never,
            page: shell.page as never,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return reply.code(201).send({
          ...template,
          theme: template.theme as z.infer<typeof TemplateSchema>["theme"],
          page: template.page as z.infer<typeof TemplateSchema>["page"],
          createdAt: template.createdAt.toISOString(),
          updatedAt: template.updatedAt.toISOString(),
        });
      } catch (err) {
        fastify.log.error(err);
        const message = err instanceof Error ? err.message : "Failed to create template from URL";
        return reply.code(400).send({ error: message });
      } finally {
        await browser?.close();
      }
    },
  );

  done();
};

export default app;
