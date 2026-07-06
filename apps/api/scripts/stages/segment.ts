// apps/api/scripts/stages/segment.ts
import {
  runSegmentStage,
} from "../../src/services/pipeline/segment-stage";
import type { StageRunner, StageContext, StageResult } from "./types";

export const segmentStage: StageRunner = {
  label: "segment",
  requires: ["extract"],
  produces: "segment",

  async run(ctx: StageContext): Promise<StageResult> {
    const artifact = await runSegmentStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      // pages not scoped at CLI level — process all pages in the extract artifact
    });

    const totalSections = artifact.pages.reduce(
      (sum, p) => sum + p.sections.length,
      0,
    );
    const visionPagesCount = artifact.pages.filter(
      (p) => p.ladder.visionUsed,
    ).length;

    return {
      stage: "segment",
      status: "pass",
      durationMs: 0,
      metrics: {
        pages: artifact.pages.length,
        sections: totalSections,
        sharedComponents: artifact.sharedComponents.length,
        visionPages: visionPagesCount,
      },
      warnings: [],
    };
  },
};
