// apps/api/scripts/stages/adapt.ts
import path from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArtifact, saveArtifact } from "../../src/utils/pipeline/artifact-store";
import { runAdaptService } from "../../src/services/template/adapt-service";
import type { SectionExtractArtifact, AdaptArtifact } from "../../src/types/pipeline-artifacts";
import type { ContractArtifact } from "../../src/types/section-contract";
import type { StageRunner, StageContext, StageResult } from "./types";

export const adaptStage: StageRunner = {
  label: "adapt",
  requires: ["section-extract", "contract"],
  produces: "adapt",

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();

    if (!ctx.newTemplateName) {
      throw new Error("adapt requires --name <templatename> (set via milo template --name)");
    }

    const artifactCtx = { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid };

    const sectionExtractStored = await loadArtifact<SectionExtractArtifact>(
      ctx.db,
      artifactCtx,
      "section-extract",
    );
    const contractStored = await loadArtifact<ContractArtifact>(
      ctx.db,
      artifactCtx,
      "contract",
    );

    if (!sectionExtractStored || !contractStored) {
      throw new Error("adapt requires section-extract and contract artifacts.");
    }

    const repoRoot = path.resolve(ctx.rendererDir, "../..");

    ctx.log(`  Adapting sections → Astro components for template "${ctx.newTemplateName}"`);

    const artifact = await runAdaptService({
      db: ctx.db,
      config: ctx.config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      templateName: ctx.newTemplateName,
      repoRoot,
      sectionExtract: sectionExtractStored.payload,
      contract: contractStored.payload,
    });

    const totalBoundProps = artifact.components.reduce(
      (sum, c) => sum + c.boundProps.length,
      0,
    );
    const totalStaticText = artifact.components.reduce(
      (sum, c) => sum + c.staticTextCount,
      0,
    );

    ctx.log(
      `  Adapted: ${artifact.components.length} components, ` +
      `${totalBoundProps} bound props, ${totalStaticText} static text nodes`,
    );

    await saveArtifact(ctx.db, artifactCtx, "adapt", artifact);

    return {
      stage: "adapt",
      status: "pass",
      durationMs: Date.now() - start,
      metrics: {
        components: artifact.components.length,
        boundProps: totalBoundProps,
        staticText: totalStaticText,
        pages: Object.keys(artifact.pageMap).length,
      },
      warnings: [],
    };
  },
};
