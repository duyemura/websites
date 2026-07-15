// apps/api/scripts/stages/nav-rebuild.ts
//
// Fast nav-only rebuild — no LLM, no re-clone.
//
// Reads sites/{uuid}/config/nav-structure.json, rebuilds Navigation from it,
// patches the existing GymSiteContent, and re-runs the Astro build + deploy.
//
// Use this whenever a gym owner:
//   - Adds a new program or page to the nav
//   - Renames a menu item
//   - Reorders links
//   - Removes a stale link
//
// The owner (or an AI assistant) edits nav-structure.json directly, then
// re-runs this stage. The template updates in ~30s with no LLM cost.
//
// Usage:
//   pnpm milo --site <uuid> --stages nav-rebuild [--theme beanburito]

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { deployTemplate } from "../../src/services/template/deploy-template.js";
import { promoteDeploy } from "../../src/services/mirror/deploy.js";
import { publishLatestStagingToProduction } from "../../src/services/site-versions.js";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store.js";
import { buildNavigation, type CapturedNavItem } from "../../src/services/template/nav-slots.js";
import { sanitizeContentCtas } from "../../src/services/template/content-mapper.js";
import type { StageRunner, StageContext, StageResult } from "./types.js";
import type { GymSiteContent } from "@milo/shared-types";

export const navRebuildStage: StageRunner = {
  label: "nav-rebuild",
  requires: ["generate"], // needs an existing GymSiteContent to patch
  produces: "",           // no artifact — updates the live site directly

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();

    const site = await ctx.db
      .selectFrom("sites")
      .select(["uuid", "workspaceUuid", "customDomain"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    const bucket = ctx.config.S3_DEPLOYMENTS_BUCKET ?? ctx.config.S3_ASSETS_BUCKET;
    const configNavKey = `sites/${ctx.siteUuid}/config/nav-structure.json`;

    // 1. Load nav-structure.json — config path first, deploy capture as fallback
    let capturedNav: CapturedNavItem[] = [];
    let navSource = "none";
    try {
      const obj = await ctx.s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: configNavKey }));
      capturedNav = JSON.parse(await obj.Body?.transformToString() ?? "[]");
      navSource = "config";
    } catch {
      // Config not set yet — try loading from last mirror deploy capture
      const mirrorDeploy = await loadArtifact<{ deployPrefix: string }>(
        ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: site.workspaceUuid }, "mirror-deploy" as any,
      );
      if (mirrorDeploy?.payload?.deployPrefix) {
        try {
          const obj = await ctx.s3Client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: `${mirrorDeploy.payload.deployPrefix}/nav-structure.json`,
          }));
          capturedNav = JSON.parse(await obj.Body?.transformToString() ?? "[]");
          navSource = "deploy-capture";
          // Seed config so next nav-rebuild uses it directly
          if (capturedNav.length > 0) {
            const { PutObjectCommand } = await import("@aws-sdk/client-s3");
            await ctx.s3Client.send(new PutObjectCommand({
              Bucket: bucket, Key: configNavKey,
              Body: Buffer.from(JSON.stringify(capturedNav, null, 2), "utf8"),
              ContentType: "application/json; charset=utf-8",
            }));
          }
        } catch { /* not yet captured */ }
      }
    }

    if (capturedNav.length > 0) {
      ctx.log(`  Nav [${navSource}]: ${capturedNav.length} top-level items — ${capturedNav.map(i => i.label).join(", ")}`);
    } else {
      ctx.log(`  [warn] No nav-structure.json found. Run clone stage to capture the original site nav.`);
    }

    // 2. Load the latest generate artifact (existing GymSiteContent)
    const generateArtifact = await loadArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: site.workspaceUuid },
      "generate" as any,
    );
    if (!generateArtifact?.payload) {
      throw new Error("No generate artifact found — run the generate stage first");
    }

    const gymContent = generateArtifact.payload as GymSiteContent;

    // 3. Rebuild Navigation from the (possibly updated) nav-structure.json
    const programs = gymContent.pages.programs ?? [];
    const navigation = buildNavigation(capturedNav, programs);

    ctx.log(`  Built nav: header=${navigation.header.length} items, footer=${navigation.footer.length} groups`);

    // 4. Patch navigation into the existing GymSiteContent — everything else unchanged.
    // Also sanitize CTAs: an existing generate artifact may contain stale source-site
    // CTA URLs that no longer map to generated pages.
    const patchedContent: GymSiteContent = {
      ...gymContent,
      navigation,
      meta: {
        ...gymContent.meta,
        ...(ctx.templateTheme ? { templateTheme: ctx.templateTheme } : {}),
      },
    };
    sanitizeContentCtas(patchedContent.pages, patchedContent.business, []);

    // 5. Build + deploy (no LLM, no content re-generation)
    const siteUrl = site.customDomain
      ? `https://${site.customDomain}`
      : `${ctx.config.CDN_BASE_URL}/sites/${site.uuid}`;

    ctx.log(`  Building Astro template with updated nav...`);
    const result = await deployTemplate({
      db: ctx.db,
      s3Client: ctx.s3Client,
      bucket,
      siteUuid: site.uuid,
      workspaceUuid: site.workspaceUuid,
      apiBaseUrl: ctx.config.CDN_BASE_URL,
      siteUrl,
      rendererDir: ctx.rendererDir,
      googleMapsApiKey: ctx.config.GOOGLE_PLACES_API_KEY,
      templateTheme: ctx.templateTheme,
      content: patchedContent,
      log: {
        info: (o, m) => ctx.log(`  [info] ${m}`),
        warn: (o, m) => ctx.log(`  [warn] ${m}`),
      },
    });

    ctx.log(`  Version ${result.version} @ ${result.deployPrefix}`);
    ctx.log(`  Promoting to staging...`);
    await promoteDeploy(ctx.s3Client, bucket, site.uuid, result.deployPrefix);

    ctx.log(`  Publishing staging → production...`);
    await publishLatestStagingToProduction(
      ctx.db, ctx.s3Client, bucket, site.uuid,
      ctx.config.CLOUDFRONT_DISTRIBUTION_ID,
      ctx.config.CLOUDFRONT_KVS_ARN,
      ctx.config.MILO_PREVIEW_DOMAIN,
      ctx.config,
    );

    const previewDomain = ctx.config.MILO_PREVIEW_DOMAIN;
    const shortId = site.uuid.slice(0, 8);
    if (previewDomain) {
      ctx.log(`  Preview:    https://${shortId}-preview.${previewDomain}/`);
      ctx.log(`  Production: https://${shortId}.${previewDomain}/`);
    }

    return {
      stage: "nav-rebuild",
      status: "pass",
      durationMs: Date.now() - start,
      metrics: {
        version: result.version,
        navItems: navigation.header.length,
        routes: result.routes,
      },
      warnings: capturedNav.length === 0 ? ["No nav-structure.json — template used fallback nav"] : [],
    };
  },
};
