// apps/api/scripts/stages/spec-audit.ts
import path from "node:path";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { runSpecAudit, writeAuditReport } from "../../src/services/template/spec-audit-service";
import type { ContractArtifact } from "../../src/types/section-contract";
import type { StageRunner, StageContext, StageResult } from "./types";
import type { TemplateTheme } from "@milo/shared-types";

export const specAuditStage: StageRunner = {
  label: "spec-audit",
  requires: ["contract"],
  produces: "",  // produces a file report, not a pipeline artifact

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();

    if (!ctx.newTemplateName) {
      throw new Error("spec-audit requires --name <templatename>");
    }

    const contractStored = await loadArtifact<ContractArtifact>(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "contract",
    );

    if (!contractStored) {
      throw new Error("spec-audit requires a contract artifact — run the contract stage first");
    }

    const repoRoot = path.resolve(ctx.rendererDir, "../..");

    const result = runSpecAudit({
      templateName: ctx.newTemplateName,
      templateTheme: (ctx.templateTheme ?? ctx.newTemplateName) as TemplateTheme,
      contract: contractStored.payload,
      repoRoot,
    });

    const reportPath = writeAuditReport(result, repoRoot);

    const { summary } = result;
    ctx.log(`  ${summary.covered}/${summary.totalSectionTypes} section types covered (${summary.scorePercent}%) — report: ${reportPath}`);

    if (summary.uncovered > 0) {
      const missing = result.coverage
        .filter((r) => r.status === "no-component" && r.tag !== "unknown" && r.tag !== "footer" && r.tag !== "header")
        .map((r) => `${r.tag}/${r.archetype}`);
      ctx.log(`  ❌ No component for: ${missing.join(", ")}`);
    } else {
      ctx.log(`  ✅ All section types covered`);
    }

    if (result.unusedComponents.length > 0) {
      ctx.log(`  ⚠️  Unused spec components: ${result.unusedComponents.join(", ")}`);
    }

    return {
      stage: "spec-audit",
      status: summary.scorePercent === 100 ? "pass" : summary.scorePercent >= 50 ? "warn" : "fail",
      durationMs: Date.now() - start,
      metrics: {
        total: summary.totalSectionTypes,
        covered: summary.covered,
        uncovered: summary.uncovered,
        score: summary.scorePercent,
      },
      warnings: result.coverage
        .filter((r) => r.status !== "covered" && r.tag !== "unknown" && r.tag !== "footer" && r.tag !== "header" && r.tag !== "nav")
        .map((r) => `${r.tag}/${r.archetype}: ${r.status}`),
    };
  },
};
