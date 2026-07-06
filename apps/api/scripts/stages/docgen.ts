// apps/api/scripts/stages/docgen.ts
import {
  runDocgenStage,
} from "../../src/services/pipeline/docgen-stage";
import { saveSiteDocs } from "../../src/utils/site-docs";
import { saveArtifact } from "../../src/utils/pipeline/artifact-store";
import type { StageRunner, StageContext, StageResult } from "./types";

export const docgenStage: StageRunner = {
  label: "docgen",
  requires: ["extract", "segment"],
  produces: "docgen",

  async run(ctx: StageContext): Promise<StageResult> {
    ctx.log(`  Model: ${ctx.config.DEFAULT_LLM_MODEL} (${ctx.config.LLM_PROVIDER})`);
    ctx.log(`  Running docgen...`);

    const docs = await runDocgenStage({
      db: ctx.db,
      config: ctx.config,
      s3: ctx.s3Client,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      mode: "replication",
    });

    await saveSiteDocs(ctx.db, ctx.workspaceUuid, docs, ctx.siteUuid);

    await saveArtifact(ctx.db, { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid }, "docgen" as any, {
      docCount: docs.length,
      docKeys: docs.map((d) => d.key),
    });

    ctx.log(`  Saved ${docs.length} docs:`);
    for (const doc of docs) {
      const preview = (doc.content ?? "").replace(/\n/g, " ").slice(0, 80);
      ctx.log(`    [${doc.key}] ${preview}`);
    }

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
