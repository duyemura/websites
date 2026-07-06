// apps/api/scripts/stages/docgen.ts
import {
  runDocgenStage,
} from "../../src/services/pipeline/docgen-stage";
import { saveSiteDocs } from "../../src/utils/site-docs";
import type { StageRunner, StageContext, StageResult } from "./types";

export const docgenStage: StageRunner = {
  label: "docgen",
  requires: ["extract", "segment"],
  // docgen produces site docs (written to the docs table), not a pipeline
  // artifact — so produces is empty to prevent the skip-if-artifact logic
  // from suppressing re-runs.
  produces: "",

  async run(ctx: StageContext): Promise<StageResult> {
    const docs = await runDocgenStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "replication",
    });

    await saveSiteDocs(ctx.db, ctx.workspaceUuid, docs, ctx.siteUuid);

    ctx.log(`  Saved ${docs.length} site docs`);

    return {
      stage: "docgen",
      status: "pass",
      durationMs: 0,
      metrics: {
        docs: docs.length,
        keys: docs.map((d) => d.key).join(", "),
      },
      warnings: [],
    };
  },
};
