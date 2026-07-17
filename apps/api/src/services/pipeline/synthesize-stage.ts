import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import { loadArtifact, saveArtifact, type ArtifactContext } from "../../utils/pipeline/artifact-store";
import type { ExtractArtifact, SegmentArtifact } from "../../types/pipeline-artifacts";
import type { ContractArtifact } from "../../types/section-contract";
import { groupSections, type ComponentGroup } from "../../utils/pipeline/section-grouper";
import { generateAstroComponent } from "../../utils/pipeline/astro-generator";
import { generateTemplateSpecSource } from "../../utils/pipeline/spec-writer";
import { generateTemplateDocs } from "../../utils/pipeline/doc-writer";
import { scaffoldTemplate } from "../../utils/pipeline/code-scaffolder";
import { chatCompletion } from "../../ai/llm-client";
import { modelForTask } from "../../ai/model-picker";
import type { S3Context } from "../../utils/pipeline/image-to-data-url";

export interface SynthesizeStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  templateName: string;
  repoRoot: string;
}

export async function runSynthesizeStage(input: SynthesizeStageInput) {
  const ctx: ArtifactContext = { siteUuid: input.siteUuid, workspaceUuid: input.workspaceUuid };

  const extract = await loadArtifact<ExtractArtifact>(input.db, ctx, "extract");
  const segment = await loadArtifact<SegmentArtifact>(input.db, ctx, "segment");
  const contract = await loadArtifact<ContractArtifact>(input.db, ctx, "contract");
  if (!extract || !segment || !contract) {
    throw new Error("extract, segment, and contract artifacts required before synthesize.");
  }

  const s3Ctx: S3Context = { s3: input.s3, bucket: input.config.S3_ASSETS_BUCKET, region: input.config.S3_REGION };

  // Build a CSS string from the top-level extract css tokens (custom properties + font declarations).
  // ExtractArtifact.css is { tokens: Record<string,string>, breakpoints, animations, webFontUrls }.
  const tokenEntries = Object.entries(extract.payload.css?.tokens ?? {});
  const siteCSS = tokenEntries.length > 0
    ? `:root {\n${tokenEntries.map(([prop, val]) => `  ${prop}: ${val};`).join("\n")}\n}`
    : "";

  const visionModel = modelForTask("vision", input.config);

  // chatFn for astro-generator: accepts arbitrary content (text + image parts).
  const visionChatFn = (req: { messages: Array<{ role: "user"; content: unknown }>; maxTokens?: number }) =>
    chatCompletion(
      { model: visionModel, messages: req.messages as Parameters<typeof chatCompletion>[0]["messages"], maxTokens: req.maxTokens },
      input.config,
    ).then((r) => r.content);

  // chatFn for doc-writer: text-only (no images) — use the cheaper default model.
  const textChatFn = (req: { messages: Array<{ role: "user"; content: string }>; maxTokens?: number }) =>
    chatCompletion(
      { model: modelForTask("default", input.config), messages: req.messages, maxTokens: req.maxTokens },
      input.config,
    ).then((r) => r.content);

  const groups = groupSections(contract.payload, segment.payload);

  // Generate all Astro components in parallel.
  const componentResults = await Promise.all(
    groups.map(async (group) => {
      const code = await generateAstroComponent(group, siteCSS, visionChatFn, s3Ctx);
      return { name: group.name, tag: group.tag, archetype: group.archetype as string, code };
    }),
  );

  // Build page map: path → ordered component names.
  const pageMap = buildPageMap(contract.payload, groups);

  const specSource = generateTemplateSpecSource(input.templateName, groups, pageMap);
  const docs = await generateTemplateDocs(input.templateName, groups, pageMap, siteCSS, textChatFn);
  const cssSource = buildDesignTokenCSS(input.templateName, groups);

  const outputPaths = scaffoldTemplate({
    templateName: input.templateName,
    components: componentResults,
    specSource,
    docs,
    cssSource,
    repoRoot: input.repoRoot,
  });

  await saveArtifact(input.db, ctx, "synthesize", {
    templateName: input.templateName,
    components: componentResults,
    specSource,
    docs,
    cssSource,
    pageMap,
  });

  return { groups: groups.length, pages: Object.keys(pageMap).length, outputPaths };
}

function buildPageMap(
  contract: ContractArtifact,
  groups: ComponentGroup[],
): Record<string, string[]> {
  const pageMap: Record<string, string[]> = {};
  for (const contractPage of contract.pages) {
    pageMap[contractPage.path] = contractPage.sections.map((s) => {
      const archetype = s.layout.archetype;
      const matched = groups.find((g) => g.tag === s.tag && g.archetype === archetype);
      if (!matched) {
        console.warn(`[synthesize] No component group for section tag="${s.tag}" archetype="${archetype}" on page "${contractPage.path}" — using fallback name`);
      }
      return matched?.name ?? deriveNameFallback(s.tag);
    });
  }
  return pageMap;
}

function deriveNameFallback(tag: string): string {
  return tag.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}

function buildDesignTokenCSS(name: string, groups: ComponentGroup[]): string {
  const hero = groups.find((g) => g.tag === "hero");
  const bgColor = hero?.exemplar.contract.layout.background.color ?? "#000000";
  const headingColor = hero?.exemplar.contract.typography?.headline?.color ?? "#ffffff";
  const bodySize = hero?.exemplar.contract.typography?.body?.size ?? "16px";
  return `:root {\n  /* Auto-generated design tokens for ${name} template */\n  --color-primary: ${bgColor};\n  --color-text: ${headingColor};\n  --font-size-body: ${bodySize};\n}\n`;
}
