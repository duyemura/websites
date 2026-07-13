import { FastifyPluginCallbackZodOpenApi } from "fastify-zod-openapi";
import { z } from "zod";
import { sql } from "kysely";
import { chromium, type Browser } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, buildS3ObjectUrl, listS3Objects } from "../../s3";
import { scrapeWebsite } from "../../utils/scrape-website";
import { generateSiteDocs, generateSiteDocsFromTemplate, saveSiteDocs } from "../../utils/site-docs";
import { enrichWithGmb } from "../../utils/gmb-enrichment";
import { cropSectionScreenshots } from "../../utils/section-screenshots";
import { HttpUrlSchema } from "../../utils/http-url";
import { TemplateShellSchema } from "@milo/shared-types";
import type { TemplateShell } from "@milo/shared-types";
import {
  logAiActivity,
  getRecentAiActivity,
  getAiActivityCostSummary,
} from "../../services/ai-activity";
import { downloadScrapedAssets } from "../../utils/scraped-assets";
import type { AiActivityAction, AiActivityOutcome } from "../../types/db";
import { loadSiteHierarchyDoc } from "../../utils/site-hierarchy-io";
import { loadSectionVisualEvidenceDoc } from "../../utils/section-visual-evidence-io";
import { loadDesignSystemDoc } from "../../utils/design-system-io";
import { jsonb } from "../../utils/jsonb";

const SiteModeSchema = z.enum(["replication", "template", "greenfield"]);
const SiteTierSchema = z.enum(["free", "paid"]);

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
  tier: SiteTierSchema.optional(),
  previewUrl: z.string().nullable().optional(),
  productionUrl: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateSiteSchema = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    sourceUrl: z.string().url().optional(),
    mode: SiteModeSchema.optional(),
    tier: SiteTierSchema.optional(),
    templateKey: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.sourceUrl) {
      if (!data.name) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "name is required when sourceUrl is not provided",
          path: ["name"],
        });
      }
      if (!data.slug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "slug is required when sourceUrl is not provided",
          path: ["slug"],
        });
      }
    }
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

const HierarchyReviewResponseSchema = z.object({
  hierarchy: z.any().openapi({ type: "object", additionalProperties: true }).nullable(),
  visualEvidence: z.any().openapi({ type: "object", additionalProperties: true }).nullable(),
  designSystem: z.any().openapi({ type: "object", additionalProperties: true }).nullable(),
});

const SiteFileTypeSchema = z.enum([
  "html",
  "css",
  "js",
  "image",
  "video",
  "font",
  "favicon",
  "other",
]);

const SiteFileSchema = z.object({
  key: z.string(),
  size: z.number(),
  lastModified: z.string().nullable().optional(),
  url: z.string(),
  type: SiteFileTypeSchema,
});

const SiteFilesResponseSchema = z.object({
  files: z.array(SiteFileSchema),
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

function sitePreviewUrls(siteUuid: string, previewDomain: string | undefined): { previewUrl: string | null; productionUrl: string | null } {
  if (!previewDomain) return { previewUrl: null, productionUrl: null };
  const shortId = siteUuid.slice(0, 8);
  return {
    previewUrl: `https://${shortId}-preview.${previewDomain}/`,
    productionUrl: `https://${shortId}.${previewDomain}/`,
  };
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
        ...sitePreviewUrls(site.uuid, fastify.config.MILO_PREVIEW_DOMAIN),
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
          400: z.object({ error: z.string() }),
          409: z.object({ error: z.string() }),
          500: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { name, slug, sourceUrl, mode, tier, templateKey } = request.body;
      const workspaceUuid = request.workspace.uuid;

      let siteName = name;
      let siteSlug = slug;
      if (sourceUrl) {
        if (!siteName) siteName = deriveSiteName(sourceUrl);
        if (!siteSlug) siteSlug = deriveSiteSlug(sourceUrl);
        siteSlug = await makeUniqueSlug(fastify.db, workspaceUuid, siteSlug);
      }

      if (!siteName || !siteSlug) {
        return reply.code(400).send({ error: "Site name and slug are required" });
      }

      const existing = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("workspaceUuid", "=", workspaceUuid)
        .where("slug", "=", siteSlug)
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
                name: `${siteName} theme`,
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

      const siteMode =
        mode ?? (templateRecord ? "template" : sourceUrl ? "replication" : null);

      const site = await fastify.db
        .insertInto("sites")
        .values({
          workspaceUuid,
          name: siteName,
          slug: siteSlug,
          status: "draft",
          themeUuid,
          ...(siteMode ? { mode: siteMode } : {}),
          ...(tier ? { tier } : {}),
          ...(sourceUrl ? { sourceUrl } : {}),
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
        const templateDocs = generateSiteDocsFromTemplate(siteName, templateRecord, templateShell);
        await saveSiteDocs(fastify.db, workspaceUuid, templateDocs, site.uuid);
      }

      return reply.code(201).send({
        ...site,
        ...sitePreviewUrls(site.uuid, fastify.config.MILO_PREVIEW_DOMAIN),
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
        ...sitePreviewUrls(site.uuid, fastify.config.MILO_PREVIEW_DOMAIN),
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
    "/sites/:uuid/hierarchy-review",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: HierarchyReviewResponseSchema,
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

      const [hierarchy, visualEvidence, designSystem] = await Promise.all([
        loadSiteHierarchyDoc(fastify.db, workspaceUuid, siteUuid),
        loadSectionVisualEvidenceDoc(fastify.db, workspaceUuid, siteUuid),
        loadDesignSystemDoc(fastify.db, workspaceUuid, siteUuid),
      ]);

      return { hierarchy, visualEvidence, designSystem };
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
        const tmpDir = path.join(os.tmpdir(), "milo-scrapes");
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
        let gmbListing: import("@milo/gmb-client").GmbListing | undefined;
        if (gmbApiKey) {
          const { data: enriched, result: gmbResult } = await enrichWithGmb(data, gmbApiKey);
          Object.assign(data, enriched);
          gmbListing = gmbResult.listing;
        }

        const siteName = deriveSiteName(url, name);
        const baseSlug = deriveSiteSlug(url);

        const docs = await generateSiteDocs(
          data,
          gmbListing,
          fastify.config,
          {
            db: fastify.db,
            workspaceUuid: request.workspace.uuid,
            userUuid: request.user.uuid,
            siteUuid: newSiteUuid,
          },
          screenshotAsset?.url ?? null,
          "replication",
        );

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
            type: "run_playbook",
            status: "pending",
            input: jsonb({ siteUuid: site.uuid, workspaceUuid, url, options: {} }),
            options: jsonb({}),
          })
          .returning("uuid")
          .executeTakeFirstOrThrow();

        try {
          await fastify.queues.pipeline.queue.add("pipeline", {
            kind: "run",
            siteUuid: site.uuid,
            workspaceUuid,
            input: { url },
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
            ...sitePreviewUrls(site.uuid, fastify.config.MILO_PREVIEW_DOMAIN),
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

  fastify.patch(
    "/sites/:uuid/notify-email",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        body: z.object({
          notifyEmail: z.string().email().nullable(),
        }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const siteUuid = request.params.uuid;
      const workspaceUuid = request.workspace.uuid;
      const { notifyEmail } = request.body;

      const result = await fastify.db
        .updateTable("sites")
        .set({ notifyEmail, updatedAt: new Date() })
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!result.numUpdatedRows || result.numUpdatedRows === 0n) {
        return reply.code(404).send({ error: "Site not found" });
      }

      return reply.code(200).send({ ok: true });
    },
  );

  fastify.post(
    "/sites/:uuid/redeploy-template",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          202: z.object({ ok: z.literal(true), jobId: z.string() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const siteUuid = request.params.uuid;
      const workspaceUuid = request.workspace.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();

      if (!site) return reply.code(404).send({ error: "Site not found" });

      const job = await fastify.queues.deployTemplate.queue.add(
        "deploy_template",
        { siteUuid, workspaceUuid },
      );

      return reply.code(202).send({ ok: true, jobId: job.id ?? "" });
    },
  );

  fastify.post(
    "/sites/:uuid/publish",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: z.object({ ok: z.literal(true), version: z.number() }),
          404: z.object({ error: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const siteUuid = request.params.uuid;
      const workspaceUuid = request.workspace.uuid;

      const site = await fastify.db
        .selectFrom("sites")
        .select("uuid")
        .where("uuid", "=", siteUuid)
        .where("workspaceUuid", "=", workspaceUuid)
        .executeTakeFirst();
      if (!site) return reply.code(404).send({ error: "Site not found" });

      const { publishLatestStagingToProduction } = await import("../../services/site-versions.js");
      const bucket = fastify.config.S3_DEPLOYMENTS_BUCKET ?? fastify.config.S3_ASSETS_BUCKET;
      const { getS3Client } = await import("../../s3.js");
      const s3Client = getS3Client({
        endpoint: fastify.config.S3_ENDPOINT,
        region: fastify.config.S3_REGION,
        accessKeyId: fastify.config.S3_ACCESS_KEY,
        secretAccessKey: fastify.config.S3_SECRET_KEY,
      });

      const result = await publishLatestStagingToProduction(
        fastify.db, s3Client, bucket, siteUuid,
        fastify.config.CLOUDFRONT_DISTRIBUTION_ID,
      );
      fastify.log.info({ siteUuid, version: result.version }, "site published to production");
      return reply.code(200).send({ ok: true, version: result.version });
    },
  );

  fastify.get(
    "/sites/:uuid/ai-activity",
    {
      schema: {
        params: z.object({ uuid: z.string().uuid() }),
        querystring: z.object({
          actionType: z.enum(["analyze", "apply_suggestion", "edit", "generate", "memory_update", "publish", "qa", "suggest"]).optional(),
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

  fastify.get(
    "/sites/:uuid/files",
    {
      schema: {
        operationId: "getSiteFiles",
        tags: ["Sites"],
        summary: "List deployed and mirrored S3 files for a site",
        params: z.object({ uuid: z.string().uuid() }),
        response: {
          200: SiteFilesResponseSchema,
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

      const s3Config = {
        endpoint: fastify.config.S3_ENDPOINT,
        region: fastify.config.S3_REGION,
        accessKeyId: fastify.config.S3_ACCESS_KEY,
        secretAccessKey: fastify.config.S3_SECRET_KEY,
        sessionToken: fastify.config.S3_SESSION_TOKEN,
        bucket: fastify.config.S3_ASSETS_BUCKET,
      };

      const prefixes = [
        `sites/${siteUuid}/`,
        `workspaces/${workspaceUuid}/sites/${siteUuid}/`,
      ];

      const objects = (
        await Promise.all(prefixes.map((prefix) => listS3Objects({ ...s3Config, prefix })))
      ).flat();

      const files = objects.map((object) => ({
        key: object.key,
        size: object.size,
        lastModified: object.lastModified?.toISOString() ?? null,
        url: buildS3ObjectUrl({
          endpoint: s3Config.endpoint,
          region: s3Config.region,
          bucket: s3Config.bucket,
          key: object.key,
        }),
        type: classifySiteFileType(object.key),
      }));

      return reply.code(200).send({ files });
    },
  );

  done();
};

async function makeUniqueSlug(
  db: import("kysely").Kysely<import("../../types/db").DB>,
  workspaceUuid: string,
  baseSlug: string,
): Promise<string> {
  let uniqueSlug = baseSlug;
  let suffix = 1;
  while (
    await db
      .selectFrom("sites")
      .select("uuid")
      .where("workspaceUuid", "=", workspaceUuid)
      .where("slug", "=", uniqueSlug)
      .executeTakeFirst()
  ) {
    suffix++;
    uniqueSlug = `${baseSlug}-${suffix}`;
  }
  return uniqueSlug;
}

function classifySiteFileType(key: string): z.infer<typeof SiteFileTypeSchema> {
  const lower = key.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  if (lower.endsWith(".html") || lower.endsWith("/index")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "js";
  if (["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(ext)) return "video";
  if (["woff", "woff2", "ttf", "otf", "eot"].includes(ext)) return "font";
  if (lower.includes("favicon") || ext === "ico") return "favicon";
  return "other";
}

export default app;
