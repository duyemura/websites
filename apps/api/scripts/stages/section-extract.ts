// apps/api/scripts/stages/section-extract.ts
import { loadArtifact, saveArtifact } from "../../src/utils/pipeline/artifact-store";
import { runSectionExtractService } from "../../src/services/template/section-extract-service";
import type { SegmentArtifact } from "../../src/types/pipeline-artifacts";
import type { ContractArtifact } from "../../src/types/section-contract";
import type { StageRunner, StageContext, StageResult } from "./types";

export const sectionExtractStage: StageRunner = {
  label: "section-extract",
  requires: ["segment", "contract"],
  produces: "section-extract",

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();
    const artifactCtx = { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid };

    const segmentStored = await loadArtifact<SegmentArtifact>(ctx.db, artifactCtx, "segment");
    const contractStored = await loadArtifact<ContractArtifact>(ctx.db, artifactCtx, "contract");

    if (!segmentStored || !contractStored) {
      throw new Error("section-extract requires segment and contract artifacts.");
    }

    // Resolve the source URL: prefer the first page URL if it contains the hostname,
    // otherwise fall back to the siteMap URL stored in the extract artifact, or derive
    // from the segment's site uuid (caller is expected to pass ctx.siteUrl).
    const sourceUrl = await resolveSourceUrl(ctx.db, artifactCtx);

    ctx.log(`  Launching browser to extract HTML from ${sourceUrl}`);

    const artifact = await runSectionExtractService({
      siteUuid: ctx.siteUuid,
      sourceUrl,
      segment: segmentStored.payload,
      contract: contractStored.payload,
    });

    const totalSections = artifact.pages.reduce((sum, p) => sum + p.sections.length, 0);
    const totalImages = artifact.pages
      .flatMap((p) => p.sections)
      .reduce((sum, s) => sum + s.images.length, 0);
    const totalTextNodes = artifact.pages
      .flatMap((p) => p.sections)
      .reduce((sum, s) => sum + s.textNodes.length, 0);

    ctx.log(
      `  Extracted: ${artifact.pages.length} pages, ${totalSections} sections, ` +
      `${totalImages} images, ${totalTextNodes} text nodes`,
    );

    await saveArtifact(ctx.db, artifactCtx, "section-extract", artifact);

    return {
      stage: "section-extract",
      status: "pass",
      durationMs: Date.now() - start,
      metrics: {
        pages: artifact.pages.length,
        sections: totalSections,
        images: totalImages,
        textNodes: totalTextNodes,
      },
      warnings: [],
    };
  },
};

/**
 * Resolves the canonical source URL for the site by reading the extract artifact
 * (which stores `url`) and falling back to the sites DB table.
 */
async function resolveSourceUrl(
  db: StageContext["db"],
  ctx: { siteUuid: string; workspaceUuid: string },
): Promise<string> {
  // Try to get from the extract artifact first — it has the original crawl URL.
  const extractStored = await loadArtifact<{ url?: string }>(db, ctx, "extract");
  if (extractStored?.payload.url) return extractStored.payload.url;

  // Fall back to the sites table
  const site = await db
    .selectFrom("sites")
    .select("sourceUrl")
    .where("uuid", "=", ctx.siteUuid)
    .executeTakeFirst();

  if (site?.sourceUrl) return site.sourceUrl;

  throw new Error(
    `section-extract: cannot resolve source URL for site ${ctx.siteUuid}. ` +
    `Run the extract stage first or ensure the site record has a sourceUrl.`,
  );
}
