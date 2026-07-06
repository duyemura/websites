// apps/api/scripts/stages/extract.ts
import {
  runExtractStage,
} from "../../src/services/pipeline/extract-stage";
import type { StageRunner, StageContext, StageResult } from "./types";

export const extractStage: StageRunner = {
  label: "extract",
  requires: [],
  produces: "extract",

  async run(ctx: StageContext): Promise<StageResult> {
    // Load sourceUrl from DB — StageContext has no url field
    const site = await ctx.db
      .selectFrom("sites")
      .select(["sourceUrl"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    if (!site.sourceUrl) {
      throw new Error("Site has no sourceUrl configured — set it before running the extract stage");
    }

    ctx.log(`  URL: ${site.sourceUrl}`);

    const artifact = await runExtractStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      url: site.sourceUrl,
      // pages and maxPages not scoped at CLI level — run full site
    });

    const warnings: string[] = [];
    const failedCount = artifact.siteMap.filter((e) => e.status === "skipped").length;
    if (failedCount > 0) {
      warnings.push(`${failedCount} page(s) failed to capture and were skipped`);
    }

    return {
      stage: "extract",
      status: warnings.length > 0 ? "warn" : "pass",
      durationMs: 0,
      metrics: {
        pages: artifact.usage.pagesCaptured,
        screenshots: artifact.usage.screenshotCount,
        siteMapEntries: artifact.siteMap.length,
      },
      warnings,
    };
  },
};
