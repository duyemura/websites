// apps/api/scripts/stages/generate.ts
// Spec-driven homepage content generation.
// Reads all site docs + content artifact, calls LLM with the template's
// content spec, and saves a complete GymSiteContent as the "generate" artifact.
// The template stage reads this artifact and passes it directly to deployTemplate,
// bypassing the content-mapper defaults entirely.
import { generateSiteContent } from "../../src/services/template/generate-content.js";
import { saveArtifact, loadArtifact } from "../../src/utils/pipeline/artifact-store.js";
import type { StageRunner, StageContext, StageResult } from "./types.js";

export const generateStage: StageRunner = {
  label: "generate",
  requires: ["docgen"],
  produces: "generate",

  async run(ctx: StageContext): Promise<StageResult> {
    const site = await ctx.db
      .selectFrom("sites")
      .select(["uuid", "workspaceUuid", "customDomain"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    const siteUrl = site.customDomain
      ? `https://${site.customDomain}`
      : `${ctx.config.CDN_BASE_URL}/sites/${site.uuid}/current`;

    const theme = ctx.templateTheme ?? "beanburito";
    ctx.log(`  Theme: ${theme}`);
    ctx.log(`  Model: ${ctx.config.DEFAULT_LLM_MODEL}`);

    const content = await generateSiteContent({
      db: ctx.db,
      config: ctx.config,
      siteUuid: site.uuid,
      workspaceUuid: site.workspaceUuid,
      apiBaseUrl: ctx.config.CDN_BASE_URL,
      siteUrl,
      templateTheme: theme,
      log: ctx.log,
    });

    // Apply theme override to meta
    if (ctx.templateTheme) {
      (content as any).meta.templateTheme = ctx.templateTheme;
    }

    await saveArtifact(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "generate" as any,
      content,
    );

    const home = content.pages.home;
    ctx.log(`  Hero: "${home.hero.headline}"`);
    ctx.log(`  Value props: ${home.valueProps?.length ?? 0}`);
    ctx.log(`  How it works: ${home.howItWorks?.length ?? 0} steps`);
    ctx.log(`  Features: ${home.features?.length ?? 0}`);
    ctx.log(`  Testimonials: ${home.testimonials?.length ?? 0}`);
    ctx.log(`  FAQ: ${home.faq?.length ?? 0} items`);

    return {
      stage: "generate",
      status: "pass",
      durationMs: 0,
      metrics: {
        hero: home.hero.headline.slice(0, 40),
        valueProps: home.valueProps?.length ?? 0,
        testimonials: home.testimonials?.length ?? 0,
        faq: home.faq?.length ?? 0,
      },
      warnings: [],
    };
  },
};
