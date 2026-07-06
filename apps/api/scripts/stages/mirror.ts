// apps/api/scripts/stages/mirror.ts
import { runMirrorPipeline } from "../../src/services/mirror/run-mirror";
import { CRAWL_TIER_PAID, CRAWL_TIER_FREE } from "../../src/types/mirror";
import { dedupeWarnings, estimateMirrorCosts } from "./types";
import type { StageRunner, StageContext, StageResult } from "./types";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import type { MirrorAssetsArtifact } from "../../src/types/mirror";

const CMS_SIGNATURES: [string, string][] = [
  ["dynamic plugin (Elementor", "elementor"],
  ["plugin:Webflow", "webflow"],
  ["Squarespace", "squarespace"],
  ["wixsite.com", "wix"],
  ["shopify", "shopify"],
];

function detectCms(warnings: string[]): string | null {
  const sample = warnings.slice(0, 50).join(" ");
  for (const [pattern, cms] of CMS_SIGNATURES) {
    if (sample.toLowerCase().includes(pattern.toLowerCase())) return cms;
  }
  return null;
}

export const mirrorStage: StageRunner = {
  label: "mirror",
  requires: [],
  produces: "mirror-deploy",
  async run(ctx: StageContext): Promise<StageResult> {
    const site = await ctx.db
      .selectFrom("sites")
      .select(["mirrorStatus", "sourceUrl"])
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();

    if (site.mirrorStatus === "crawling") {
      throw new Error(
        "Site is already being mirrored — wait for it to complete or manually reset mirrorStatus",
      );
    }
    if (!site.sourceUrl) throw new Error("Site has no sourceUrl configured");

    ctx.log(`  URL: ${site.sourceUrl}`);

    const result = await runMirrorPipeline({
      db: ctx.db,
      config: ctx.config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      tier: ctx.tier === "paid" ? CRAWL_TIER_PAID : CRAWL_TIER_FREE,
      log: {
        info: (_o, m) => {
          if (ctx.verbose) ctx.log(`  [info] ${m}`);
        },
        warn: (_o, m) => ctx.log(`  [warn] ${m}`),
      },
    });

    const cms = detectCms(result.warnings);
    // Return raw warnings — renderReport deduplicates. Double-dedup causes fragment artifacts.
    const deduped = result.warnings;

    // Estimate cost: load assets artifact for actual captured count
    const assetsArtifact = await loadArtifact<MirrorAssetsArtifact>(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "mirror-assets",
    );
    const assetCount = assetsArtifact?.payload?.assets?.length ?? 200;
    const costs = estimateMirrorCosts(result.pageCount, assetCount);

    return {
      stage: "mirror",
      status: deduped.length > 0 ? "warn" : "pass",
      durationMs: 0,
      metrics: {
        pages: result.pageCount,
        warnings: result.warnings.length,
        ...(cms ? { cms } : {}),
      },
      warnings: deduped,
      costs,
    };
  },
};
