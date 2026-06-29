import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { sql } from "kysely";
import { chromium, type Browser } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "../../s3";
import { scrapeWebsite } from "../../utils/scrape-website";
import { generateSiteDocs, saveSiteDocs } from "../../utils/site-docs";

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

const ScrapeSiteSchema = z.object({
  url: z.string().url(),
  name: z.string().optional(),
});

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

const ScrapeSiteResponseSchema = z.object({
  site: SiteSchema,
  docs: z.array(DocSchema),
  screenshotAsset: z
    .object({
      uuid: z.string(),
      url: z.string(),
      storageKey: z.string(),
    })
    .nullable()
    .optional(),
});

function deriveSiteSlug(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const base = hostname.split(".")[0]?.replace(/[^a-z0-9]+/g, "-") ?? "site";
    return base.replace(/^-|-$/g, "").toLowerCase() || "site";
  } catch {
    return "site";
  }
}

function deriveSiteName(url: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    const name = hostname.split(".")[0] ?? "Imported site";
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return "Imported site";
  }
}

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

  fastify.post(
    "/sites/scrape",
    {
      schema: {
        body: ScrapeSiteSchema,
        response: { 201: ScrapeSiteResponseSchema },
      },
    },
    async (request, reply) => {
      const { url, name } = request.body;
      const workspaceUuid = request.workspace.uuid;
      let browser: Browser | undefined;

      try {
        browser = await chromium.launch({ headless: true });
        const tmpDir = path.join(os.tmpdir(), "ploy-gyms-scrapes");
        await mkdir(tmpDir, { recursive: true });
        const screenshotPath = path.join(
          tmpDir,
          `scrape-${Date.now()}.png`,
        );
        const data = await scrapeWebsite(browser, {
          url,
          takeScreenshot: true,
          screenshotPath,
          captureHtml: false,
        });

        let screenshotAsset: {
          uuid: string;
          url: string;
          storageKey: string;
        } | null = null;

        try {
          const screenshotBuffer = await readFile(screenshotPath);
          const s3 = getS3Client({
            endpoint: fastify.config.S3_ENDPOINT,
            region: fastify.config.S3_REGION,
            accessKeyId: fastify.config.S3_ACCESS_KEY,
            secretAccessKey: fastify.config.S3_SECRET_KEY,
          });
          const storageKey = path.posix.join(
            "workspaces",
            workspaceUuid,
            "assets",
            `scrape-${Date.now()}-screenshot.png`,
          );
          await s3.send(
            new PutObjectCommand({
              Bucket: fastify.config.S3_ASSETS_BUCKET,
              Key: storageKey,
              Body: screenshotBuffer,
              ContentType: "image/png",
            }),
          );
          const publicUrl = `${fastify.config.CDN_BASE_URL.replace(/\/$/, "")}/${
            fastify.config.S3_ASSETS_BUCKET
          }/${storageKey}`;

          const asset = await fastify.db
            .insertInto("assets")
            .values({
              workspaceUuid,
              name: `${deriveSiteName(url, name)} screenshot`,
              type: "image",
              mimeType: "image/png",
              url: publicUrl,
              storageKey,
              metadata: {
                filename: "screenshot.png",
                description: `Full-page screenshot of ${url} captured during scrape`,
                tags: ["scrape", "screenshot"],
              },
            })
            .returningAll()
            .executeTakeFirstOrThrow();

          data.screenshotUrls = [publicUrl];
          screenshotAsset = {
            uuid: asset.uuid,
            url: publicUrl,
            storageKey,
          };
        } catch {
          // Screenshot upload is best-effort; continue without it.
          data.screenshotUrls = [];
        }

        const docs = generateSiteDocs(data);

        let baseSlug = deriveSiteSlug(url);
        let slug = baseSlug;
        let suffix = 1;
        while (
          await fastify.db
            .selectFrom("sites")
            .select("uuid")
            .where("workspaceUuid", "=", workspaceUuid)
            .where("slug", "=", slug)
            .executeTakeFirst()
        ) {
          suffix++;
          slug = `${baseSlug}-${suffix}`;
        }

        const siteName = deriveSiteName(url, name);
        const site = await fastify.db
          .insertInto("sites")
          .values({
            workspaceUuid,
            name: siteName,
            slug,
            status: "draft",
            themeUuid: null,
            defaultMetaTitle: data.title,
            defaultMetaDescription: data.description,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await saveSiteDocs(fastify.db, workspaceUuid, docs);

        const savedDocs = await fastify.db
          .selectFrom("docs")
          .selectAll()
          .where("workspaceUuid", "=", workspaceUuid)
          .where(
            "key",
            "in",
            docs.map((d) => d.key),
          )
          .execute();

        return reply.code(201).send({
          site: {
            ...site,
            createdAt: site.createdAt.toISOString(),
            updatedAt: site.updatedAt.toISOString(),
          },
          docs: savedDocs.map((doc) => ({
            ...doc,
            createdAt: doc.createdAt.toISOString(),
            updatedAt: doc.updatedAt.toISOString(),
          })),
          screenshotAsset,
        });
      } finally {
        await browser?.close();
      }
    },
  );

  done();
};

export default app;
