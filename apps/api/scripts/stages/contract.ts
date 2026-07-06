// apps/api/scripts/stages/contract.ts
import { runContractStage } from "../../src/services/pipeline/contract-stage";
import type { StageRunner, StageContext, StageResult } from "./types";

export const contractStage: StageRunner = {
  label: "contract",
  requires: ["extract", "segment"],
  produces: "contract",

  async run(ctx: StageContext): Promise<StageResult> {
    const artifact = await runContractStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
    });

    const totalSections = artifact.pages.reduce(
      (sum, p) => sum + p.sections.length,
      0,
    );
    const classifiedSections = artifact.pages.flatMap((p) =>
      p.sections.filter((s) => s.layout.archetype !== "unknown")
    ).length;

    ctx.log(
      `  Contract built: ${artifact.pages.length} pages, ${totalSections} sections, ${classifiedSections} classified`,
    );

    return {
      stage: "contract",
      status: "pass",
      durationMs: 0,
      metrics: {
        pages: artifact.pages.length,
        sections: totalSections,
        classified: classifiedSections,
      },
      warnings: [],
    };
  },
};
