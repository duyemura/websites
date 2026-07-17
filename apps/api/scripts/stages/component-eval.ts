import path from "node:path";
import { runComponentEvalStage } from "../../src/services/pipeline/component-eval-stage.js";
import type { StageRunner, StageContext, StageResult } from "./types";

export const componentEvalStage: StageRunner = {
  label: "component-eval",
  requires: ["synthesize"],
  produces: "",

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();
    if (!ctx.newTemplateName) throw new Error("component-eval requires --name <templatename>");
    const repoRoot = path.resolve(ctx.rendererDir, "../..");
    const { results, reportPath } = await runComponentEvalStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      templateName: ctx.newTemplateName,
      rendererDir: ctx.rendererDir,
      repoRoot,
    });
    const passed = results.filter((r) => r.passed).length;
    ctx.log(`  ${passed}/${results.length} passed ≥85 — report: ${reportPath}`);
    return {
      stage: "component-eval",
      status: passed === results.length ? "pass" : "warn",
      durationMs: Date.now() - start,
      metrics: { total: results.length, passed, failed: results.length - passed },
      warnings: results.filter((r) => !r.passed).map((r) => `${r.componentName}: score ${r.finalScore}`),
    };
  },
};
