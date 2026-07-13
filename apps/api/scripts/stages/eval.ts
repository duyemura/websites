// apps/api/scripts/stages/eval.ts
// `milo eval` runs the standalone per-page QA evaluator.
import path from "node:path";
import { perPageEvalStage } from "./per-page-eval.js";
import { withLocalDistServer } from "../../src/utils/serve-local-dist.js";
import type { StageRunner, StageContext, StageResult } from "./types";

// Default no-options runner used by the registry-driven upgrade pipeline.
// Evaluates the freshly built Astro dist locally so post-publish QA is not
// blocked by CloudFront/KVS propagation delays.
export const evalStage: StageRunner = {
  label: "Per-page QA eval (local dist)",
  requires: [],
  produces: "",
  async run(ctx: StageContext): Promise<StageResult> {
    const distDir = path.join(ctx.rendererDir, "dist");
    try {
      return await withLocalDistServer(distDir, async (localUrl) => {
        const runner = perPageEvalStage({ path: "/", url: localUrl });
        return await runner.run(ctx);
      });
    } catch (err) {
      return {
        stage: "eval",
        status: "fail",
        durationMs: 0,
        metrics: {},
        warnings: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
