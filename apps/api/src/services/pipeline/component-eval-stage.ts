import path from "node:path";
import fs from "node:fs";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import { loadArtifact, type ArtifactContext } from "../../utils/pipeline/artifact-store";
import type { SynthesizeArtifact } from "../../types/pipeline-artifacts";
import { runEvalLoop, type EvalLoopResult, type ComponentTarget } from "../../utils/pipeline/eval-loop";
import { buildFixture } from "../../utils/pipeline/fixture-generator";
import { imageUrlToDataUri, type S3Context } from "../../utils/pipeline/image-to-data-url";
import { chatCompletion } from "../../ai/llm-client";
import { modelForTask } from "../../ai/model-picker";

export interface ComponentEvalStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  templateName: string;
  rendererDir: string;
  repoRoot: string;
  componentFilter?: string;
}

export async function runComponentEvalStage(input: ComponentEvalStageInput) {
  const ctx: ArtifactContext = { siteUuid: input.siteUuid, workspaceUuid: input.workspaceUuid };
  const synthesize = await loadArtifact<SynthesizeArtifact>(input.db, ctx, "synthesize");
  if (!synthesize) throw new Error("synthesize artifact required");

  const s3Ctx: S3Context = {
    s3: input.s3,
    bucket: input.config.S3_ASSETS_BUCKET,
    region: input.config.S3_REGION,
  };
  const loadImageFn = (url: string) => imageUrlToDataUri(url, s3Ctx);
  const chatFn = async (req: { messages: any[]; maxTokens?: number }) => {
    const resp = await chatCompletion({ ...req, model: modelForTask("vision", input.config) }, input.config);
    return resp.content;
  };

  // Write gym.json for the Astro build — renderer reads src/content/gym.json directly.
  const fixture = buildFixture(synthesize.payload);
  const gymJsonPath = path.join(input.rendererDir, "src/content/gym.json");
  fs.mkdirSync(path.dirname(gymJsonPath), { recursive: true });
  fs.writeFileSync(gymJsonPath, JSON.stringify(fixture, null, 2), "utf8");

  const componentsDir = path.join(input.repoRoot, "apps/renderer/src/components/sections", input.templateName);
  const components = synthesize.payload.components.filter(
    (c) => !input.componentFilter || c.name === input.componentFilter,
  );

  const results: EvalLoopResult[] = [];

  for (const component of components) {
    // Use the exemplar crop and page persisted on the component result
    // (not re-derived from segment by tag, which picks the wrong exemplar
    // when multiple components share a tag with different archetypes)
    const pagePath = component.exemplarPage ?? "/";

    const target: ComponentTarget = {
      name: component.name,
      filePath: path.join(componentsDir, `${component.name}.astro`),
      originalCropDesktop: component.cropDesktop,
      pagePath,
    };

    try {
      const result = await runEvalLoop(target, input.rendererDir, loadImageFn, chatFn);
      results.push(result);
    } catch (err) {
      console.warn(`[component-eval] runEvalLoop failed for ${component.name}:`, err);
      results.push({
        componentName: component.name,
        finalScore: 0,
        iterations: 0,
        passed: false,
        remainingIssues: [{
          property: "eval-loop",
          expected: "completed",
          actual: err instanceof Error ? err.message : String(err),
          severity: "critical",
        }],
      });
    }
  }

  const reportPath = writeGapReport(input.templateName, results, input.repoRoot);
  return { results, reportPath };
}

function writeGapReport(name: string, results: EvalLoopResult[], repoRoot: string): string {
  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  const lines = [
    `# ${name} — component eval report`,
    ``,
    `Overall: ${passed.length}/${results.length} components passed (score ≥ 85)`,
    ``,
    ...results
      .sort((a, b) => a.finalScore - b.finalScore)
      .flatMap((r) => {
        const icon = r.passed ? "✅" : "❌";
        const issueLines = r.remainingIssues.map(
          (i) => `- **${i.property}**: expected ${i.expected}, got ${i.actual} [${i.severity}]`,
        );
        return [`## ${icon} ${r.componentName} — score: ${r.finalScore} (${r.iterations} iterations)`, ...issueLines, ``];
      }),
  ];

  if (failed.length > 0) {
    lines.push(
      `## Next steps`,
      `For each ❌ component, fix the .astro file then run:`,
      `\`\`\``,
      `milo template-eval --name ${name} --component <ComponentName>`,
      `\`\`\``,
    );
  }

  const dir = path.join(repoRoot, "docs/template-review");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${name}-gaps.md`);
  fs.writeFileSync(p, lines.join("\n"), "utf8");
  return p;
}
