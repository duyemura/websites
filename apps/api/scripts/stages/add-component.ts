// apps/api/scripts/stages/add-component.ts
//
// Human-triggered, AI-assisted component creation.
// Called via `milo template add-component --name <template> --section <tag/archetype>`.
//
// Workflow:
//  1. Find the section in the contract artifact by tag+archetype
//  2. Run section-extract to capture its HTML + CSS from the source site
//  3. Run adapt to generate a DRAFT .astro file (saved as .astro.draft)
//  4. Print what was created and the next steps for human review

import path from "node:path";
import fs from "node:fs";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { runSectionExtractService } from "../../src/services/template/section-extract-service";
import { runAdaptService } from "../../src/services/template/adapt-service";
import type { ContractArtifact } from "../../src/types/section-contract";
import type { SegmentArtifact } from "../../src/types/pipeline-artifacts";
import type { StageRunner, StageContext, StageResult } from "./types";

export const addComponentStage: StageRunner = {
  label: "add-component",
  requires: ["contract", "segment"],
  produces: "",

  async run(ctx: StageContext): Promise<StageResult> {
    const start = Date.now();

    if (!ctx.newTemplateName) throw new Error("add-component requires --name <template>");
    if (!ctx.componentFilter) throw new Error("add-component requires --component <tag/archetype>");

    const [sectionTag, sectionArchetype] = ctx.componentFilter.split("/");
    if (!sectionTag) throw new Error("--component must be in format tag/archetype (e.g. booking-calendar/appointment-scheduler)");

    const artifactCtx = { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid };

    const contractStored = await loadArtifact<ContractArtifact>(ctx.db, artifactCtx, "contract");
    const segmentStored  = await loadArtifact<SegmentArtifact>(ctx.db, artifactCtx, "segment");

    if (!contractStored || !segmentStored) throw new Error("add-component requires contract and segment artifacts");

    // Find the section in the contract
    const contractSection = contractStored.payload.pages
      .flatMap((p) => p.sections)
      .find((s) => s.tag === sectionTag && (!sectionArchetype || s.layout.archetype === sectionArchetype));

    if (!contractSection) {
      throw new Error(
        `Section "${ctx.componentFilter}" not found in contract artifact.\n` +
        `Detected sections: ${contractStored.payload.pages.flatMap((p) => p.sections).map((s) => `${s.tag}/${s.layout.archetype}`).join(", ")}`,
      );
    }

    // Resolve source URL
    const extractArtifact = await loadArtifact<{ url?: string }>(ctx.db, artifactCtx, "extract").catch(() => null);
    const siteRow = await ctx.db.selectFrom("sites").select("sourceUrl").where("uuid", "=", ctx.siteUuid).executeTakeFirst();
    const sourceUrl = extractArtifact?.payload.url ?? siteRow?.sourceUrl;
    if (!sourceUrl) throw new Error("Cannot resolve source URL — run extract stage first");

    ctx.log(`  Extracting HTML+CSS for section "${sectionTag}/${sectionArchetype ?? "*"}" from ${sourceUrl}`);

    // Run section-extract for just this section
    const repoRoot = path.resolve(ctx.rendererDir, "../..");
    const extractResult = await runSectionExtractService({
      siteUuid: ctx.siteUuid,
      sourceUrl,
      segment: segmentStored.payload,
      contract: contractStored.payload,
    });

    const extractedSection = extractResult.pages
      .flatMap((p) => p.sections)
      .find((s) => s.tag === sectionTag && (!sectionArchetype || s.archetype === sectionArchetype));

    if (!extractedSection) {
      throw new Error(`Section "${ctx.componentFilter}" was not extracted — check that the source page is accessible`);
    }

    ctx.log(`  Running adapt to generate draft component...`);

    // Derive a PascalCase component name from the section type
    const componentName = (sectionArchetype ?? sectionTag)
      .split(/[-_/]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("");

    // Run adapt on just this one section
    const adaptResult = await runAdaptService({
      db: ctx.db,
      config: ctx.config,
      siteUuid: ctx.siteUuid,
      workspaceUuid: ctx.workspaceUuid,
      templateName: ctx.newTemplateName,
      repoRoot,
      sectionExtract: {
        siteUuid: ctx.siteUuid,
        sourceUrl,
        templateName: ctx.newTemplateName,
        capturedAt: new Date().toISOString(),
        pages: [{
          path: "/",
          url: sourceUrl,
          sections: [extractedSection],
          images: [],
        }],
      },
      contract: contractStored.payload,
    });

    // Rename the generated file to .astro.draft so it's visible but not active
    const componentsDir = path.join(repoRoot, "apps/renderer/src/components/sections", ctx.newTemplateName);
    const generatedPath = path.join(componentsDir, `${componentName}.astro`);
    const draftPath     = path.join(componentsDir, `${componentName}.astro.draft`);

    if (fs.existsSync(generatedPath)) {
      // Prepend DRAFT notice
      const code = fs.readFileSync(generatedPath, "utf8");
      const draft =
        `// ⚠️  DRAFT — generated by milo adapt, NOT yet reviewed\n` +
        `// Review this component, then:\n` +
        `//   1. Rename: ${componentName}.astro.draft → ${componentName}.astro\n` +
        `//   2. Add to modernSpec.sectionMapping: "${sectionTag}/${sectionArchetype ?? "*"}": "${componentName}"\n` +
        `//   3. Add to sections/${ctx.newTemplateName}/index.ts COMPONENT_MAP\n` +
        `//   4. Commit both files together\n\n` +
        code;
      fs.writeFileSync(draftPath, draft, "utf8");
      fs.unlinkSync(generatedPath); // remove the non-draft version
    }

    ctx.log(`  ✅ Draft written: ${path.relative(repoRoot, draftPath)}`);
    ctx.log(`  Review the draft, then follow the instructions at the top of the file.`);

    return {
      stage: "add-component",
      status: "pass",
      durationMs: Date.now() - start,
      metrics: {
        section: `${sectionTag}/${sectionArchetype ?? "*"}`,
        component: componentName,
        draft: path.relative(repoRoot, draftPath),
      },
      warnings: [
        `Draft created — human review required before ${componentName} can be used`,
      ],
    };
  },
};
