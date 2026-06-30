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
import { enrichWithGmb } from "../../utils/gmb-enrichment";
import { HttpUrlSchema } from "../../utils/http-url";
import { TemplateShellSchema } from "@ploy-gyms/shared-types";
import type { TemplateShell } from "@ploy-gyms/shared-types";
import { logAiActivity } from "../../services/ai-activity";

const SiteSchema = z.object({
  uuid: z.string(),
  workspaceUuid: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["draft", "published", "archived"]),
  themeUuid: z.string().nullable().optional(),
  defaultMetaTitle: z.string().nullable().optional(),
  defaultMetaDescription: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateSiteSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  templateKey: z.string().optional(),
});

const ScrapeSiteSchema = z.object({
  url: HttpUrlSchema,
  name: z.string().optional(),
});

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

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname === "/" ? "" : parsed.pathname.toLowerCase();
    return `${hostname}${path}`;
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  }
}

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

function generateSiteDocsFromTemplate(
  siteName: string,
  template: { key: string; name: string; instructions: string | null },
  shell: TemplateShell,
): import("../../utils/site-docs").GeneratedSiteDoc[] {
  const now = new Date().toISOString();
  const instructions = template.instructions ?? "No template instructions provided.";

  const siteMemory = [
    `# Site memory: ${siteName}`,
    "",
    `- **Created from template**: ${template.name} (${template.key})`,
    `- **Created at**: ${now}`,
    `- **Source URL**: ${shell.source.url}`,
    "",
    "## Template structure",
    "",
    shell.page.sections.map((s) => `- ${s.type} (${s.id})`).join("\n"),
    "",
    "## Placeholders",
    "",
    shell.placeholders.length > 0
      ? shell.placeholders.map((p) => `- **${p.key}** — ${p.label}`).join("\n")
      : "- No placeholders defined.",
  ].join("\n");

  const siteStrategy = [
    `# Site strategy: ${siteName}`,
    "",
    `Build a site using the **${template.name}** template. The template's structure and spacing were extracted from ${shell.source.url}.`,
    "",
    "## AI instructions from template",
    "",
    instructions,
    "",
    "## Build plan",
    "",
    "1. Read [[workspace-memory]] and [[brand-guidelines]].",
    "2. Use the business info below to replace every placeholder in the template.",
    "3. Preserve section order from the template unless the user asks otherwise.",
    "4. Generate real copy that matches the gym's tone, not the source website's brand.",
    "",
    "## Next action",
    "",
    "Fill out [[business-info]] with the gym's real details, then generate the homepage.",
  ].join("\n");

  const businessInfo = [
    `# Business info: ${siteName}`,
    "",
    "Fill in the details below so the AI can replace the template placeholders with real copy.",
    "",
    "## Required information",
    "",
    "- **Business name**:",
    "- **Tagline / one-liner**:",
    "- **Address**:",
    "- **Hours**:",
    "- **Phone**:",
    "- **Email**:",
    "- **Primary offerings / classes**:",
    "- **Coaches / team members**:",
    "- **Member testimonials**:",
    "",
    "## Brand notes",
    "",
    "- **Tone**: (e.g., energetic, welcoming, elite, community-focused)",
    "- **Colors**: (the template uses a neutral shell; apply brand colors from [[brand-guidelines]])",
    "- **Hero image direction**: (describe the desired main photo)",
  ].join("\n");

  return [
    { key: "site-memory", title: "Site memory", content: siteMemory, source: "ai_extracted" },
    { key: "site-strategy", title: "Site strategy", content: siteStrategy, source: "ai_extracted" },
    { key: "business-info", title: "Business info", content: businessInfo, source: "ai_extracted" },
  ];
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
        operationId: "createSite",
        tags: ["Sites"],
        summary: "Create a site",
        description: "Creates a new site in the workspace, optionally seeded from a template.",
        body: CreateSiteSchema,
        response: {
          201: SiteSchema,
          409: z.object({ error: z.string() }),
          500: z.object({ error: z.string() }),
        },
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
      let templateShell: TemplateShell | undefined;
      let templateRecord: { key: string; name: string; instructions: string | null } | undefined;

      if (templateKey) {
        const template = await fastify.db
          .selectFrom("templates")
          .select(["key", "name", "instructions", "sourceUrl", "placeholders", "theme", "page"])
          .where("key", "=", templateKey)
          .where((eb) =>
            eb.or([
              eb("workspaceUuid", "=", workspaceUuid),
              eb("isSystem", "=", true),
            ]),
          )
          .executeTakeFirst();

        if (template) {
          templateRecord = template;
          const shellResult = TemplateShellSchema.safeParse({
            source: {
              type: "url",
              url: template.sourceUrl ?? "",
              scrapedAt: new Date().toISOString(),
            },
            theme: template.theme,
            page: template.page,
            placeholders: template.placeholders ?? [],
            instructions: template.instructions ?? "",
          });
          if (!shellResult.success) {
            fastify.log.error(
              { errors: shellResult.error.issues },
              `Stored template shell for ${templateKey} is invalid`,
            );
            return reply.code(500).send({ error: "Stored template shell is invalid" });
          }
          templateShell = shellResult.data;

          if (templateShell.theme) {
            const theme = await fastify.db
              .insertInto("themes")
              .values({
                workspaceUuid,
                name: `${name} theme`,
                source: "system_preset",
                templateKey,
                tokens: templateShell.theme as never,
              })
              .returning("uuid")
              .executeTakeFirstOrThrow();
            themeUuid = theme.uuid;
          }

          homepageSections = Array.isArray(templateShell.page.sections)
            ? templateShell.page.sections
            : [];
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

      if (templateRecord && templateShell) {
        const templateDocs = generateSiteDocsFromTemplate(name, templateRecord, templateShell);
        await saveSiteDocs(fastify.db, workspaceUuid, templateDocs, site.uuid);
      }

      return reply.code(201).send({
        ...site,
        createdAt: site.createdAt.toISOString(),
        updatedAt: site.updatedAt.toISOString(),
      });
    },
  );

  fastify.get(
    "/sites/:uuid",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 200: SiteSchema, 404: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const site = await fastify.db
        .selectFrom("sites")
        .selectAll()
        .where("uuid", "=", request.params.uuid)
        .where("workspaceUuid", "=", request.workspace.uuid)
        .executeTakeFirst();

      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      return {
        ...site,
        createdAt: site.createdAt.toISOString(),
        updatedAt: site.updatedAt.toISOString(),
      };
    },
  );

  fastify.get(
    "/sites/:uuid/docs",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: { 200: z.array(DocSchema) },
      },
    },
    async (request) => {
      const docs = await fastify.db
        .selectFrom("docs")
        .selectAll()
        .where("workspaceUuid", "=", request.workspace.uuid)
        .where("siteUuid", "=", request.params.uuid)
        .where("status", "!=", "archived")
        .orderBy("createdAt", "desc")
        .execute();

      return docs.map((doc) => ({
        ...doc,
        createdAt: doc.createdAt.toISOString(),
        updatedAt: doc.updatedAt.toISOString(),
      }));
    },
  );

  fastify.post(
    "/sites/scrape",
    {
      schema: {
        body: ScrapeSiteSchema.extend({ force: z.boolean().optional() }),
        response: {
          201: ScrapeSiteResponseSchema,
          409: z.object({
            error: z.string(),
            siteUuid: z.string().optional(),
            status: z.string().optional(),
            requiresConfirmation: z.boolean().optional(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { url, name, force } = request.body;
      const workspaceUuid = request.workspace.uuid;
      const normalized = normalizeUrl(url);

      const match = await fastify.db
        .selectFrom("sites")
        .selectAll()
        .where("workspaceUuid", "=", workspaceUuid)
        .where("sourceUrl", "=", normalized)
        .executeTakeFirst();

      if (match) {
        if (match.status === "published") {
          return reply.code(409).send({
            error: "Published sites can’t be rescanned. Unpublish the site before scanning again.",
            siteUuid: match.uuid,
            status: match.status,
            requiresConfirmation: false,
          });
        }

        if (!force) {
          return reply.code(409).send({
            error:
              "A site already exists for this URL. Rescanning will replace its content. Confirm to continue.",
            siteUuid: match.uuid,
            status: match.status,
            requiresConfirmation: true,
          });
        }
      }

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

        const gmbApiKey = fastify.config.GOOGLE_PLACES_API_KEY;
        let gmbListing: import("@ploy-gyms/gmb-client").GmbListing | undefined;
        if (gmbApiKey) {
          const { data: enriched, result: gmbResult } = await enrichWithGmb(data, gmbApiKey);
          Object.assign(data, enriched);
          gmbListing = gmbResult.listing;
        }

        const siteName = deriveSiteName(url, name);
        const baseSlug = deriveSiteSlug(url);

        // Clean up old site-derived state before generating new docs so the
        // new ai_activity entries for this scrape are preserved.
        if (match) {
          await fastify.db
            .deleteFrom("aiActivity")
            .where("siteUuid", "=", match.uuid)
            .execute();
          await fastify.db
            .deleteFrom("aiJobs")
            .where("siteUuid", "=", match.uuid)
            .execute();
          await fastify.db
            .deleteFrom("deployments")
            .where("siteUuid", "=", match.uuid)
            .execute();
          await fastify.db
            .deleteFrom("pages")
            .where("siteUuid", "=", match.uuid)
            .execute();
          await fastify.db
            .deleteFrom("docs")
            .where("siteUuid", "=", match.uuid)
            .execute();
        }

        const docs = await generateSiteDocs(data, gmbListing, fastify.config, {
          db: fastify.db,
          workspaceUuid: request.workspace.uuid,
          userUuid: request.user.uuid,
          siteUuid: match?.uuid,
        });

        // For rescans, reuse the existing slug. For new sites, find a unique slug.
        let uniqueSlug = match ? match.slug : baseSlug;
        if (!match) {
          let suffix = 1;
          while (
            await fastify.db
              .selectFrom("sites")
              .select("uuid")
              .where("workspaceUuid", "=", workspaceUuid)
              .where("slug", "=", uniqueSlug)
              .executeTakeFirst()
          ) {
            suffix++;
            uniqueSlug = `${baseSlug}-${suffix}`;
          }
        }

        const site = match
          ? await fastify.db
              .updateTable("sites")
              .set({
                name: siteName,
                slug: uniqueSlug,
                status: "draft",
                sourceUrl: normalized,
                defaultMetaTitle: data.title,
                defaultMetaDescription: data.description,
                updatedAt: new Date(),
              })
              .where("uuid", "=", match.uuid)
              .returningAll()
              .executeTakeFirstOrThrow()
          : await fastify.db
              .insertInto("sites")
              .values({
                workspaceUuid,
                name: siteName,
                slug: uniqueSlug,
                status: "draft",
                themeUuid: null,
                sourceUrl: normalized,
                defaultMetaTitle: data.title,
                defaultMetaDescription: data.description,
              })
              .returningAll()
              .executeTakeFirstOrThrow();

        await saveSiteDocs(fastify.db, workspaceUuid, docs, site.uuid);

        const childActivities = await fastify.db
          .selectFrom("aiActivity")
          .select((eb) => [
            eb.fn.sum("costUsd").as("totalCostUsd"),
            eb.fn.sum(eb.fn.coalesce("inputTokens", eb.val(0))).as("inputTokens"),
            eb.fn.sum(eb.fn.coalesce("outputTokens", eb.val(0))).as("outputTokens"),
            eb.fn.count("uuid").as("count"),
          ])
          .where("workspaceUuid", "=", workspaceUuid)
          .where("siteUuid", "=", site.uuid)
          .where("createdAt", ">=", new Date(Date.now() - 5 * 60 * 1000))
          .executeTakeFirst();

        await logAiActivity(fastify.db, {
          workspaceUuid,
          userUuid: request.user.uuid,
          siteUuid: site.uuid,
          actionType: "generate",
          provider: fastify.config.LLM_PROVIDER,
          promptTemplateKeys: ["site-scrape", "workspace-memory-extraction", "brand-guidelines", "business-info", "site-strategy", "blueprint-draft"],
          inputDocKeys: [],
          inputTokens: childActivities?.inputTokens != null ? Number(childActivities.inputTokens) : null,
          outputTokens: childActivities?.outputTokens != null ? Number(childActivities.outputTokens) : null,
          costUsd: childActivities?.totalCostUsd != null ? Number(childActivities.totalCostUsd) : null,
          outcome: "success",
          summary: `Scraped ${url} and generated ${docs.length} docs for ${siteName}`,
          metadata: {
            sourceUrl: url,
            normalizedUrl: normalized,
            docCount: docs.length,
            childAiActivityCount: childActivities?.count != null ? Number(childActivities.count) : 0,
            hasScreenshot: screenshotAsset != null,
            hasGmb: gmbListing != null,
          },
        });

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
