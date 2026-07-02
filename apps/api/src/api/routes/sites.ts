import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { sql } from "kysely";
import { chromium, type Browser } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, buildS3ObjectUrl, getSignedDownloadUrl } from "../../s3";
import { scrapeWebsite } from "../../utils/scrape-website";
import { generateSiteDocs, saveSiteDocs } from "../../utils/site-docs";
import { enrichWithGmb } from "../../utils/gmb-enrichment";
import { cropSectionScreenshots } from "../../utils/section-screenshots";
import { HttpUrlSchema } from "../../utils/http-url";
import { TemplateShellSchema } from "@ploy-gyms/shared-types";
import type { TemplateShell } from "@ploy-gyms/shared-types";
import {
  logAiActivity,
  getRecentAiActivity,
  getAiActivityCostSummary,
} from "../../services/ai-activity";
import {
  startSiteBuild,
  approvePage,
} from "../../services/site-generation-orchestrator";
import { downloadScrapedAssets } from "../../utils/scraped-assets";
import type { AiActivityAction, AiActivityOutcome } from "../../types/db";
import { loadBlueprintDoc } from "../../utils/blueprint-io";
import { jsonb } from "../../utils/jsonb";
import { resolveBuildCommand } from "../../services/build-assistant/registry";

const SiteModeSchema = z.enum(["replication", "template", "greenfield"]);

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
  mode: SiteModeSchema.optional(),
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
  aiJobUuid: z.string().uuid(),
  screenshotAsset: z
    .object({
      uuid: z.string(),
      url: z.string(),
      storageKey: z.string(),
    })
    .nullable()
    .optional(),
});

const SiteBlueprintSchema = z.object({
  site_metadata: z.object({
    framework: z.string(),
    mode: z.string(),
    target_url: z.string(),
    business_name: z.string().optional(),
    generated_at: z.string(),
  }),
  design_tokens: z.any(),
  global_shell: z.any(),
  pages: z.array(z.any()),
  build_plan: z.object({
    next_page: z.string(),
    page_status: z.record(z.string()),
    build_order: z.array(z.string()),
  }),
});

const BuildStatusResponseSchema = z.object({
  site: SiteSchema,
  aiJob: z
    .object({
      uuid: z.string(),
      type: z.string(),
      status: z.string(),
      state: z.any().nullable(),
      steps: z.any().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
  deployment: z
    .object({
      uuid: z.string(),
      buildId: z.string(),
      status: z.string(),
      previewUrl: z.string().nullable().optional(),
      artifactUrl: z.string().nullable().optional(),
      metadata: z.any().nullable().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
  blueprint: SiteBlueprintSchema.nullable(),
  aiActivity: z.array(z.any()),
});

const BuildCommandResponseSchema = z.object({
  reply: z.string(),
  action: z.string().nullable(),
  enqueued: z.boolean(),
  messages: z
    .array(
      z.object({
        role: z.enum(["assistant", "user"]),
        content: z.string(),
      }),
    )
    .optional(),
  userMessage: z.string().optional(),
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

  fastify.get(
    "/sites/:uuid/build-status",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: BuildStatusResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const workspaceUuid = request.workspace.uuid;
      const siteUuid = request.params.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .selectAll()
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const aiJob = await fastify.db
        .selectFrom("aiJobs")
        .selectAll()
        .where("siteUuid", "=", siteUuid)
        .orderBy("createdAt", "desc")
        .executeTakeFirst();

      const deployment = await fastify.db
        .selectFrom("deployments")
        .selectAll()
        .where("siteUuid", "=", siteUuid)
        .orderBy("createdAt", "desc")
        .executeTakeFirst();

      const blueprint = await loadBlueprintDoc(fastify.db, workspaceUuid, siteUuid);

      const aiActivity = await getRecentAiActivity(fastify.db, {
        workspaceUuid,
        siteUuid,
        limit: 20,
      });

      return {
        site: {
          ...site,
          createdAt: site.createdAt.toISOString(),
          updatedAt: site.updatedAt.toISOString(),
        },
        aiJob: aiJob
          ? {
              ...aiJob,
              createdAt: aiJob.createdAt.toISOString(),
              updatedAt: aiJob.updatedAt.toISOString(),
            }
          : null,
        deployment: deployment
          ? {
              ...deployment,
              createdAt: deployment.createdAt.toISOString(),
              updatedAt: deployment.updatedAt.toISOString(),
            }
          : null,
        blueprint,
        aiActivity: aiActivity.map((a) => ({
          ...a,
          createdAt: a.createdAt.toISOString(),
        })),
      };
    },
  );

  fastify.post(
    "/sites/:uuid/build-commands",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        body: z.object({ message: z.string().min(1) }),
        response: {
          200: BuildCommandResponseSchema,
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const workspaceUuid = request.workspace.uuid;
      const siteUuid = request.params.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .selectAll()
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const deployment = await fastify.db
        .selectFrom("deployments")
        .selectAll()
        .where("siteUuid", "=", siteUuid)
        .orderBy("createdAt", "desc")
        .executeTakeFirst();

      const blueprint = await loadBlueprintDoc(fastify.db, workspaceUuid, siteUuid);

      const ctx = {
        db: fastify.db,
        queues: fastify.queues,
        config: fastify.config,
        workspaceUuid,
        siteUuid,
        userUuid: request.user.uuid,
        site,
        deployment: deployment ?? null,
        blueprint,
      };

      const action = await resolveBuildCommand(request.body.message, ctx);
      return action.execute(request.body.message, ctx);
    },
  );

  fastify.post(
    "/sites/scrape",
    {
      schema: {
        body: ScrapeSiteSchema,
        response: {
          201: ScrapeSiteResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { url, name } = request.body;
      const workspaceUuid = request.workspace.uuid;
      const normalized = normalizeUrl(url);

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

        const newSiteUuid = crypto.randomUUID();

        let screenshotAsset: {
          uuid: string;
          url: string;
          storageKey: string;
        } | null = null;

        const s3 = getS3Client({
          endpoint: fastify.config.S3_ENDPOINT,
          region: fastify.config.S3_REGION,
          accessKeyId: fastify.config.S3_ACCESS_KEY,
          secretAccessKey: fastify.config.S3_SECRET_KEY,
          sessionToken: fastify.config.S3_SESSION_TOKEN,
        });

        try {
          const screenshotBuffer = await readFile(screenshotPath);
          const storageKey = path.posix.join(
            "workspaces",
            workspaceUuid,
            "sites",
            newSiteUuid,
            "screenshots",
            `scrape-${Date.now()}.png`,
          );
          await s3.send(
            new PutObjectCommand({
              Bucket: fastify.config.S3_ASSETS_BUCKET,
              Key: storageKey,
              Body: screenshotBuffer,
              ContentType: "image/png",
            }),
          );
          const publicUrl = buildS3ObjectUrl({
            endpoint: fastify.config.S3_ENDPOINT,
            region: fastify.config.S3_REGION,
            bucket: fastify.config.S3_ASSETS_BUCKET,
            key: storageKey,
          });

          const asset = await fastify.db
            .insertInto("assets")
            .values({
              workspaceUuid,
              name: `${deriveSiteName(url, name)} screenshot`,
              type: "image",
              source: "screenshot",
              mimeType: "image/png",
              url: publicUrl,
              storageKey,
              metadata: {
                filename: "screenshot.png",
                description: `Full-page screenshot of ${url} captured during scrape`,
                tags: ["scrape", "screenshot", "reference-screenshot", "index"],
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

        try {
          const evidenceRows = data.sections?.map((s) => s.visualEvidence) ?? [];
          const cropped = await cropSectionScreenshots(screenshotPath, evidenceRows);
          for (const shot of cropped) {
            try {
              const storageKey = path.posix.join(
                "workspaces",
                workspaceUuid,
                "sites",
                newSiteUuid,
                "sections",
                `${shot.evidenceId}.png`,
              );
              await s3.send(
                new PutObjectCommand({
                  Bucket: fastify.config.S3_ASSETS_BUCKET,
                  Key: storageKey,
                  Body: shot.buffer,
                  ContentType: "image/png",
                }),
              );
              const url = buildS3ObjectUrl({
                endpoint: fastify.config.S3_ENDPOINT,
                region: fastify.config.S3_REGION,
                bucket: fastify.config.S3_ASSETS_BUCKET,
                key: storageKey,
              });
              await fastify.db
                .insertInto("assets")
                .values({
                  workspaceUuid,
                  name: shot.metadata.filename,
                  type: "image",
                  source: "screenshot",
                  mimeType: "image/png",
                  url,
                  storageKey,
                  metadata: shot.metadata,
                })
                .execute();
              const row = evidenceRows.find((r) => r.evidenceId === shot.evidenceId);
              if (row) row.screenshotUrl = url;
            } catch (err) {
              fastify.log.warn(
                { err, evidenceId: shot.evidenceId },
                "Failed to upload section screenshot",
              );
            }
          }
        } catch {
          // Section screenshot upload is best-effort; continue without it.
        }

        try {
          const assetMap = await downloadScrapedAssets(
            fastify.db,
            fastify.config,
            workspaceUuid,
            newSiteUuid,
            data.images,
          );
          for (const image of data.images) {
            const local = assetMap.byOriginalUrl.get(image.url);
            if (local) {
              image.url = local.url;
              image.assetUuid = local.assetUuid;
              fastify.queues.classifyAssets.queue
                .add(
                  "classify_assets",
                  {
                    workspaceUuid,
                    assetUuid: local.assetUuid,
                    userUuid: request.user.uuid,
                    siteUuid: newSiteUuid,
                  },
                  { jobId: local.assetUuid },
                )
                .catch((err) => {
                  fastify.log.warn(
                    { err, assetUuid: local.assetUuid },
                    "Failed to enqueue scraped asset classification",
                  );
                });
            }
          }
        } catch {
          // Asset download is best-effort; continue with original third-party URLs.
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

        const docs = await generateSiteDocs(data, gmbListing, fastify.config, {
          db: fastify.db,
          workspaceUuid: request.workspace.uuid,
          userUuid: request.user.uuid,
          siteUuid: newSiteUuid,
        });

        // Find a unique slug in this workspace.
        let uniqueSlug = baseSlug;
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

        const site = await fastify.db
          .insertInto("sites")
          .values({
            uuid: newSiteUuid,
            workspaceUuid,
            name: siteName,
            slug: uniqueSlug,
            status: "draft",
            mode: "replication",
            themeUuid: null,
            sourceUrl: normalized,
            defaultMetaTitle: data.title,
            defaultMetaDescription: data.description,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        await saveSiteDocs(fastify.db, workspaceUuid, docs, site.uuid);

        const aiJob = await fastify.db
          .insertInto("aiJobs")
          .values({
            workspaceUuid,
            siteUuid: site.uuid,
            type: "replicate_site",
            status: "pending",
            input: jsonb({ siteUuid: site.uuid, workspaceUuid, url, options: {} }),
            options: jsonb({}),
          })
          .returning("uuid")
          .executeTakeFirstOrThrow();

        try {
          await fastify.queues.replicateSite.queue.add("replicate_site", {
            workspaceUuid,
            siteUuid: site.uuid,
            url,
            aiJobUuid: aiJob.uuid,
          });
        } catch (err) {
          await fastify.db
            .updateTable("aiJobs")
            .set({
              status: "failed",
              state: jsonb({ phase: "failed", error: err instanceof Error ? err.message : "enqueue failed" }),
              steps: jsonb([{ name: "enqueue", status: "failed" }]),
              updatedAt: new Date(),
            })
            .where("uuid", "=", aiJob.uuid)
            .execute();
          throw err;
        }

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
          aiJobUuid: aiJob.uuid,
          screenshotAsset,
        });
      } finally {
        await browser?.close();
      }
    },
  );

  fastify.post(
    "/sites/:uuid/generate",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        body: z.object({
          accuracy: z.enum(["fast", "balanced", "accurate"]).optional(),
          maxQaIterations: z.number().int().min(1).optional(),
          maxBudgetUsd: z.number().min(0).optional(),
          fidelityThreshold: z.number().min(0).max(1).optional(),
          mode: SiteModeSchema.optional(),
        }),
        response: {
          200: z.object({ aiJobUuid: z.string(), attemptId: z.string(), status: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const workspaceUuid = request.workspace.uuid;
      const siteUuid = request.params.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const result = await startSiteBuild({
        db: fastify.db,
        queues: fastify.queues,
        config: fastify.config,
        workspaceUuid,
        siteUuid,
        requestedMode: request.body.mode,
        accuracy: request.body.accuracy,
        maxQaIterations: request.body.maxQaIterations,
        maxBudgetUsd: request.body.maxBudgetUsd,
        fidelityThreshold: request.body.fidelityThreshold,
        userUuid: request.user.uuid,
      });

      return result;
    },
  );

  fastify.post(
    "/sites/:uuid/pages/:slug/approve",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid(), slug: z.string().min(1) }),
        response: {
          200: z.object({ approved: z.string(), remainingPagesEnqueued: z.array(z.string()) }),
          404: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const workspaceUuid = request.workspace.uuid;
      const siteUuid = request.params.uuid;
      const pageSlug = request.params.slug;

      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      try {
        const result = await approvePage({
          db: fastify.db,
          queues: fastify.queues,
          workspaceUuid,
          siteUuid,
          pageSlug,
          userUuid: request.user.uuid,
        });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Approval failed";
        return reply.code(409).send({ error: message });
      }
    },
  );

  async function previewRedirect(
    request: import("fastify").FastifyRequest<{
      Params: { uuid: string; attemptId: string };
    }>,
    reply: import("fastify").FastifyReply,
  ) {
    const deployment = await fastify.db
      .selectFrom("deployments")
      .select(["previewUrl", "metadata"])
      .where("siteUuid", "=", request.params.uuid)
      .where("buildId", "=", request.params.attemptId)
      .orderBy("createdAt", "desc")
      .executeTakeFirst();

    if (!deployment?.previewUrl) {
      return reply.code(404).send({ error: "Preview not found" });
    }

    const s3Meta = (deployment.metadata as { s3?: { bucket: string; previewKey: string } } | null)?.s3;
    if (s3Meta?.bucket && s3Meta?.previewKey) {
      const signedUrl = await getSignedDownloadUrl({
        endpoint: fastify.config.S3_ENDPOINT,
        region: fastify.config.S3_REGION,
        accessKeyId: fastify.config.S3_ACCESS_KEY,
        secretAccessKey: fastify.config.S3_SECRET_KEY,
        sessionToken: fastify.config.S3_SESSION_TOKEN,
        bucket: s3Meta.bucket,
        key: s3Meta.previewKey,
        expiresIn: 300,
      });
      return reply.redirect(signedUrl);
    }

    return reply.redirect(deployment.previewUrl);
  }

  const previewRouteConfig = {
    schema: {
      params: z.object({ uuid: z.string().uuid(), attemptId: z.string() }),
      response: {
        302: z.any(),
        404: z.object({ error: z.string() }),
      },
    },
  };

  fastify.get("/sites/:uuid/preview/:attemptId", previewRouteConfig, previewRedirect);
  fastify.get("/sites/:uuid/preview/:attemptId/*", previewRouteConfig, previewRedirect);

  fastify.get(
    "/sites/:uuid/deployments",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: z.array(
            z.object({
              uuid: z.string(),
              buildId: z.string(),
              status: z.enum(["building", "failed", "pending", "success"]),
              previewUrl: z.string().nullable().optional(),
              artifactUrl: z.string().nullable().optional(),
              metadata: z.any().nullable().optional(),
              createdAt: z.string(),
              updatedAt: z.string(),
            }),
          ),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const workspaceUuid = request.workspace.uuid;
      const siteUuid = request.params.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const deployments = await fastify.db
        .selectFrom("deployments")
        .selectAll()
        .where("siteUuid", "=", siteUuid)
        .orderBy("createdAt", "desc")
        .execute();

      return deployments.map((d) => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
        updatedAt: d.updatedAt.toISOString(),
      }));
    },
  );

  fastify.get(
    "/sites/:uuid/ai-activity",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        querystring: z.object({
          actionType: z.enum(["analyze", "apply_suggestion", "edit", "generate", "memory_update", "publish", "qa", "replicate", "suggest"]).optional(),
          outcome: z.enum(["failure", "partial", "rejected", "success", "user_edited"]).optional(),
          limit: z.coerce.number().int().min(1).max(500).optional().default(50),
        }),
        response: {
          200: z.object({
            activities: z.array(
              z.object({
                uuid: z.string(),
                workspaceUuid: z.string(),
                siteUuid: z.string().nullable(),
                userUuid: z.string(),
                aiJobUuid: z.string().nullable(),
                actionType: z.string(),
                model: z.string().nullable(),
                provider: z.string().nullable(),
                promptTemplateKeys: z.string().nullable(),
                inputDocKeys: z.string().nullable(),
                inputTokens: z.number().nullable(),
                outputTokens: z.number().nullable(),
                costUsd: z.number().nullable(),
                latencyMs: z.number().nullable(),
                outcome: z.string(),
                fidelityScore: z.number().nullable(),
                summary: z.string(),
                errorMessage: z.string().nullable(),
                userCorrection: z.string().nullable(),
                metadata: z.any().nullable(),
                createdAt: z.string(),
              }),
            ),
            summary: z.object({
              totalCostUsd: z.number(),
              totalTokens: z.number(),
              count: z.number(),
            }),
          }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const workspaceUuid = request.workspace.uuid;
      const siteUuid = request.params.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();
      if (!site) {
        return reply.code(404).send({ error: "Site not found" });
      }

      const { actionType, outcome, limit } = request.query;

      const [activities, summary] = await Promise.all([
        getRecentAiActivity(fastify.db, {
          workspaceUuid,
          siteUuid,
          actionType: actionType as AiActivityAction | undefined,
          outcome: outcome as AiActivityOutcome | undefined,
          limit,
        }),
        getAiActivityCostSummary(fastify.db, {
          workspaceUuid,
          siteUuid,
          actionType: actionType as AiActivityAction | undefined,
          outcome: outcome as AiActivityOutcome | undefined,
          // Rollup rows (actionType = 'generate' for scrape summaries) duplicate
          // child costs already represented by their underlying LLM calls. Exclude
          // them so site totals reflect actual LLM invocations, not summary rows.
          excludeActionTypes: ["generate"],
        }),
      ]);

      return {
        activities: activities.map((a) => ({
          ...a,
          costUsd: a.costUsd != null ? Number(a.costUsd) : null,
          fidelityScore: a.fidelityScore != null ? Number(a.fidelityScore) : null,
          createdAt: a.createdAt.toISOString(),
        })),
        summary,
      };
    },
  );

  done();
};

export default app;
