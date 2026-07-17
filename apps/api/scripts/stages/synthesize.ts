// apps/api/scripts/stages/synthesize.ts
import path from "node:path";
import { runSynthesizeStage } from "../../src/services/pipeline/synthesize-stage.js";
import type { StageRunner, StageContext, StageResult } from "./types";

export const synthesizeStage: StageRunner = {
  label: "synthesize",
  requires: ["extract", "segment", "contract"],
  produces: "synthesize",

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();
    if (!ctx.newTemplateName) throw new Error("synthesize requires --name <templatename>");
    const repoRoot = path.resolve(ctx.rendererDir, "../..");
    const result = await runSynthesizeStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      templateName: ctx.newTemplateName,
      repoRoot,
    });
    ctx.log(`  ${result.groups} components, ${result.pages} pages → ${result.outputPaths.componentsDir}`);
    return {
      stage: "synthesize",
      status: "pass",
      durationMs: Date.now() - start,
      metrics: { components: result.groups, pages: result.pages },
      warnings: [],
    };
  },
};
