import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";

import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import type {
  DesignSystemV2,
  ResponsiveRule,
} from "../../types/design-system-v2";
import type {
  HierarchyPage,
  HierarchySection,
  SiteHierarchy,
} from "../../types/site-hierarchy";
import type {
  SectionVisualEvidence,
  SectionVisualEvidenceRow,
} from "../../types/section-visual-evidence";
import {
  loadSiteHierarchyDoc,
  saveSiteHierarchyDoc,
  updatePageStatus,
} from "../../utils/site-hierarchy-io";
import { loadDesignSystemDoc } from "../../utils/design-system-io";
import { loadSectionVisualEvidenceDoc } from "../../utils/section-visual-evidence-io";
import {
  saveArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";
import { uploadPipelineImage } from "../../utils/pipeline/s3-upload";
import {
  breakpointDeltasToTailwind,
  type TailwindInstruction,
} from "../../utils/pipeline/breakpoint-tailwind";
import {
  renderVisualBlock,
  renderVisualBlockWithFlag,
  renderFallbackBlock,
} from "../visual-section-renderer";
import {
  writeProjectScaffold,
  writePageFiles,
  sharedComponentFileName,
} from "../astro-code-generator";
import { renderSemanticSection } from "../../utils/section-component-registry";
import { makeDefaultHeader, makeDefaultFooter } from "../astro-code-generator";
import type { SiteSection } from "@ploy-gyms/shared-types";
import { mkdir, writeFile, stat } from "node:fs/promises";

export type BuildLogCategory =
  | "consistency"
  | "seo"
  | "accessibility"
  | "performance"
  | "semantics";

export interface BuildLogEntry {
  category: BuildLogCategory;
  description: string;
  page?: string;
}

export interface BuildStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  /** Optional scope: only build these page slugs. Defaults to
   *  `hierarchy.buildPlan.buildOrder`. */
  pages?: string[];
  /** Optional override for the output source dir; primarily for tests. */
  sourceDir?: string;
  /** Whether to run `pnpm install` + `astro build` after writing source files,
   *  producing a `dist/` for the verify stage. Defaults to false for backwards
   *  compatibility with tests that don't have real Astro scaffolds; production
   *  pipeline runs (eval harness, HTTP worker) should set this to true. */
  runAstroBuild?: boolean;
  /** Whether to run `astro check` as a post-pass. Defaults to false (opt-in)
   *  because it requires the Astro project to have `node_modules` installed.
   *  Callers that install deps first can set this true. */
  runAstroCheck?: boolean;
}

export interface BuildStageResult {
  builtPages: string[];
  sharedComponentsBuilt: string[];
  buildLog: BuildLogEntry[];
  fallbacks: Array<{ sectionId: string; page: string }>;
  sourceDir: string;
}

interface AstroCheckError {
  file: string;
  message: string;
}

function hierarchyHeroToSiteSection(section: HierarchySection): SiteSection {
  return {
    id: section.id,
    type: "Hero",
    props: {
      title: section.content.heading ?? "",
      subtitle: section.content.body ?? "",
      eyebrow: section.content.eyebrow ?? null,
      cta: section.content.cta ?? null,
      backgroundImage: section.content.images?.[0]?.url ?? null,
      styleHint: section.styleHint ?? null,
    },
  };
}

function getEvidenceForSection(
  visualEvidence: SectionVisualEvidence | null,
  section: HierarchySection,
): SectionVisualEvidenceRow | undefined {
  return visualEvidence?.rows.find(
    (row) => row.evidenceId === section.evidenceId,
  );
}

/**
 * Build the responsive rule set for a section from the (site-wide) design
 * system rules. Rules from the design system apply globally; we return them
 * all — the LLM prompt lists them per selector so it can pick the ones that
 * matter for this section.
 */
function tailwindForSection(designSystem: DesignSystemV2): TailwindInstruction[] {
  const rules: ResponsiveRule[] = designSystem.responsive?.rules ?? [];
  if (rules.length === 0) return [];
  return breakpointDeltasToTailwind(rules);
}

/**
 * Media re-hosting pre-pass: downloads every mediaUrls entry across the
 * hierarchy pages, uploads to S3 under the pipeline build prefix, and rewrites
 * the URL in-place. Failed downloads are skipped with a build-log warning.
 * Returns the log entries appended.
 */
export async function rehostMedia(
  hierarchy: SiteHierarchy,
  input: {
    s3: S3Client;
    config: Config;
    workspaceUuid: string;
    siteUuid: string;
  },
): Promise<BuildLogEntry[]> {
  const log: BuildLogEntry[] = [];
  const prefix = `workspaces/${input.workspaceUuid}/sites/${input.siteUuid}/pipeline/build/media`;
  const seen = new Map<string, string>(); // original -> new URL

  async function rehostUrl(original: string, pageSlug: string): Promise<string | undefined> {
    const cached = seen.get(original);
    if (cached) return cached;
    try {
      const res = await fetch(original);
      if (!res.ok) throw new Error(`fetch ${original} → ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") ?? "image/jpeg";
      const ext = extForContentType(contentType);
      const key = `${prefix}/${hashFragment(original)}${ext}`;
      const newUrl = await uploadPipelineImage(input.s3, input.config, key, buf, contentType);
      seen.set(original, newUrl);
      log.push({
        category: "performance",
        description: `Re-hosted ${original} as ${newUrl}`,
        page: pageSlug,
      });
      return newUrl;
    } catch (err) {
      log.push({
        category: "performance",
        description: `Failed to re-host ${original}: ${(err as Error).message}`,
        page: pageSlug,
      });
      return undefined;
    }
  }

  for (const page of hierarchy.pages) {
    for (const section of page.sections) {
      const images = section.content.images ?? [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (!img) continue;
        const original = img.url;
        if (!original || original.startsWith("data:")) continue;
        const newUrl = await rehostUrl(original, page.slug);
        if (newUrl) img.url = newUrl;
      }

      const items = section.content.items ?? [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;
        const original = item.imageUrl;
        if (!original || original.startsWith("data:")) continue;
        const newUrl = await rehostUrl(original, page.slug);
        if (newUrl) item.imageUrl = newUrl;
      }
    }
  }
  return log;
}

function extForContentType(ct: string): string {
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  if (ct.includes("svg")) return ".svg";
  return ".jpg";
}

function hashFragment(input: string): string {
  // Simple non-crypto hash; the goal is stable naming for cache identity.
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * Render all shared components once for a hierarchy (or a single page's
 * worth of sections). Returns a map of sharedComponentId → rendered Astro
 * source that `writeSharedComponents` / `generateAstroPage` can consume.
 *
 * Exported so both `runBuildStage` (whole-hierarchy build) and the legacy
 * per-page `buildPage` orchestrator can share the same rendering path.
 * Without this, page rendering that skips `sharedComponentId` sections
 * would fail at astro build time with a missing-import error.
 */
export async function renderSharedComponents(
  pages: HierarchyPage[],
  designSystem: DesignSystemV2,
  evidence: SectionVisualEvidence | null,
  config: Config,
): Promise<Map<string, string>> {
  const built = new Map<string, string>();
  const tailwind = tailwindForSection(designSystem);

  // Collect first-member sections for each unique sharedComponentId.
  const byId = new Map<
    string,
    { section: HierarchySection; propFields?: string[] }
  >();
  for (const page of pages) {
    for (const section of page.sections) {
      const id = section.sharedComponentId;
      if (!id || byId.has(id)) continue;
      const propFields = section.sharedProps ? Object.keys(section.sharedProps) : undefined;
      byId.set(id, { section, propFields });
    }
  }

  for (const [id, { section, propFields }] of byId) {
    const row = getEvidenceForSection(evidence, section);
    const extraInstructions =
      propFields && propFields.length
        ? `Expose these as Astro props with the shown defaults: ${JSON.stringify(propFields)}. Use \`Astro.props\` in the frontmatter and destructure each prop with a sensible default.`
        : undefined;
    const source = await renderVisualBlock({
      section,
      evidence: row,
      designSystem,
      tailwindInstructions: tailwind,
      extraInstructions,
      config,
    });
    built.set(id, source);
  }

  return built;
}

/**
 * Render one page's non-shared section files. Returns { section, source }
 * tuples — the caller passes them to `writePageFiles`.
 */
async function renderPageSections(
  page: HierarchyPage,
  designSystem: DesignSystemV2,
  evidence: SectionVisualEvidence | null,
  config: Config,
): Promise<{ section: HierarchySection; source: string; isFallback: boolean }[]> {
  const tailwind = tailwindForSection(designSystem);
  const out: { section: HierarchySection; source: string; isFallback: boolean }[] = [];
  for (let i = 0; i < page.sections.length; i++) {
    const section = page.sections[i];
    if (!section) continue;
    if (section.sharedComponentId) continue; // handled by shared build
    const previousTag = page.sections[i - 1]?.tag;
    const nextTag = page.sections[i + 1]?.tag;

    if (section.tag === "header") {
      const headerSection = designSystem.global.shell.header ?? makeDefaultHeader(designSystem);
      out.push({ section, source: renderSemanticSection(headerSection), isFallback: false });
    } else if (section.tag === "footer") {
      const footerSection = designSystem.global.shell.footer ?? makeDefaultFooter(designSystem);
      out.push({ section, source: renderSemanticSection(footerSection), isFallback: false });
    } else if (section.tag === "hero") {
      out.push({ section, source: renderSemanticSection(hierarchyHeroToSiteSection(section)), isFallback: false });
    } else {
      const row = getEvidenceForSection(evidence, section);
      const result = await renderVisualBlockWithFlag({
        section,
        evidence: row,
        designSystem,
        tailwindInstructions: tailwind,
        previousTag,
        nextTag,
        config,
      });
      out.push({ section, source: result.code, isFallback: result.isFallback });
    }
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Run a subprocess in the given directory; resolves when done. Throws on non-zero exit. */
async function runProcess(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code ?? "null"} in ${cwd}`));
    });
    child.on("error", reject);
  });
}

/** Run `astro check` in the given source dir. Returns an empty array if the
 *  Astro CLI is not installed (best-effort). */
async function runAstroCheck(sourceDir: string): Promise<AstroCheckError[]> {
  const astroBin = path.join(sourceDir, "node_modules", ".bin", "astro");
  if (!(await fileExists(astroBin))) return [];
  return new Promise((resolve) => {
    const child = spawn(astroBin, ["check"], { cwd: sourceDir, env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", () => {
      resolve(parseAstroCheckOutput(`${stdout}\n${stderr}`));
    });
    child.on("error", () => resolve([]));
  });
}

function parseAstroCheckOutput(output: string): AstroCheckError[] {
  const errors: AstroCheckError[] = [];
  // Rough parser: match lines like "src/pages/index.astro:12:5 - ..."
  const re = /(src\/(?:pages|components)\/[^\s:]+\.astro)[:\s]+([^\n]+)/g;
  for (const match of output.matchAll(re)) {
    errors.push({ file: match[1] as string, message: match[2] as string });
  }
  return errors;
}

export async function runBuildStage(input: BuildStageInput): Promise<BuildStageResult> {
  const ctx: ArtifactContext = {
    siteUuid: input.siteUuid,
    workspaceUuid: input.workspaceUuid,
  };

  // 1. Load docs.
  const hierarchy = await loadSiteHierarchyDoc(input.db, input.workspaceUuid, input.siteUuid);
  if (!hierarchy) {
    throw new Error(`Site hierarchy not found for site ${input.siteUuid}`);
  }
  const designSystemDoc = await loadDesignSystemDoc(input.db, input.workspaceUuid, input.siteUuid);
  if (!designSystemDoc || designSystemDoc.version !== "2") {
    throw new Error(`Design system v2 not found for site ${input.siteUuid}`);
  }
  const designSystem = designSystemDoc as DesignSystemV2;
  const evidence = await loadSectionVisualEvidenceDoc(input.db, input.workspaceUuid, input.siteUuid);

  const buildLog: BuildLogEntry[] = [];
  const fallbacks: Array<{ sectionId: string; page: string }> = [];

  // 2. Media re-hosting pre-pass.
  const mediaLog = await rehostMedia(hierarchy, {
    s3: input.s3,
    config: input.config,
    workspaceUuid: input.workspaceUuid,
    siteUuid: input.siteUuid,
  });
  buildLog.push(...mediaLog);

  // 3. Determine scope.
  // input.pages may be URL-path form ("/", "/about") or slug form ("index", "about").
  // Normalise to slug form so the filter works regardless of which the caller passes.
  const rawScope = input.pages ?? hierarchy.buildPlan.buildOrder;
  const scope = new Set(rawScope.map((s) => {
    if (s === "/" || s === "index") return "index";
    const withoutLeading = s.replace(/^\//, "");
    // If it looks like a slug already (no slashes, lowercase, hyphens), keep it.
    // Otherwise treat it as a path and slugify it via the same rules pathToSlug uses.
    return withoutLeading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "index";
  }));
  const scopedPages = hierarchy.pages.filter((p) => scope.has(p.slug));

  // 4. Prepare source dir + scaffold.
  const sourceDir =
    input.sourceDir ??
    path.join(os.tmpdir(), "ploy-gyms-build", input.siteUuid, "build");
  await mkdir(sourceDir, { recursive: true });
  await writeProjectScaffold(sourceDir, designSystem);

  // 5. Shared components — render once for all pages in the hierarchy so
  //    downstream page imports always resolve.
  const sharedComponents = await renderSharedComponents(
    hierarchy.pages,
    designSystem,
    evidence,
    input.config,
  );
  const sharedComponentsBuilt: string[] = [];
  // Write shared components (plus Header/Footer) into the scaffold via
  // writePageFiles' scaffold write path — but shared components are file-level
  // artifacts, not tied to a specific page. Write them directly.
  for (const [id, source] of sharedComponents) {
    const filePath = path.join(
      sourceDir,
      "src",
      "components",
      "shared",
      `${sharedComponentFileName(id)}.astro`,
    );
    await writeFile(filePath, source);
    sharedComponentsBuilt.push(id);
  }

  // Also emit the Header / Footer semantic files so page-level imports
  // succeed; these mirror what `writeProjectFiles` does per-page.
  await writeHeaderFooter(sourceDir, designSystem);

  // 6. Per-page loop.
  const builtPages: string[] = [];
  let currentHierarchy = hierarchy;
  for (const page of scopedPages) {
    console.log(`[build] rendering page "${page.slug}" (${page.sections.length} sections)`);
    currentHierarchy = updatePageStatus(currentHierarchy, page.slug, "in_progress");
    const rendered = await renderPageSections(page, designSystem, evidence, input.config);
    // Log per-section outcome.
    for (const { section, isFallback } of rendered) {
      if (isFallback) {
        console.log(`[build]   ⚠  ${section.id} (${section.tag}) — fallback block`);
      } else {
        console.log(`[build]   ✓  ${section.id} (${section.tag})`);
      }
    }
    await writePageFiles(sourceDir, page, rendered);
    currentHierarchy = updatePageStatus(currentHierarchy, page.slug, "built");
    builtPages.push(page.slug);
  }

  // 7. astro check post-pass (best-effort, opt-in).
  if (input.runAstroCheck) {
    const errors = await runAstroCheck(sourceDir);
    for (const err of errors) {
      const match = err.file.match(/components\/sections\/([^/]+)\.astro$/);
      const sectionId = match?.[1];
      if (!sectionId) continue;
      // Find the page + section this file came from.
      let ownerPage: HierarchyPage | undefined;
      let ownerSection: HierarchySection | undefined;
      for (const p of scopedPages) {
        const s = p.sections.find((sec) => sec.id === sectionId);
        if (s) {
          ownerPage = p;
          ownerSection = s;
          break;
        }
      }
      if (!ownerPage || !ownerSection) continue;

      const row = getEvidenceForSection(evidence, ownerSection);
      const tailwind = tailwindForSection(designSystem);
      try {
        const retry = await renderVisualBlockWithFlag({
          section: ownerSection,
          evidence: row,
          designSystem,
          tailwindInstructions: tailwind,
          extraInstructions: `Your previous output failed astro check with: ${err.message}. Fix and return the corrected component.`,
          config: input.config,
        });
        const filePath = path.join(
          sourceDir,
          "src",
          "components",
          "sections",
          `${sectionId}.astro`,
        );
        await writeFile(filePath, retry.code);
        // If renderVisualBlock silently fell back (missing evidence, empty LLM
        // response, or thrown LLM error) we still overwrote the file — but
        // with deterministic content, not a fixed LLM output. Record it so
        // callers know the retry didn't actually succeed.
        if (retry.isFallback) {
          fallbacks.push({ sectionId, page: ownerPage.slug });
          buildLog.push({
            category: "consistency",
            description: `LLM retry fell back to deterministic block for ${sectionId}`,
            page: ownerPage.slug,
          });
        }
      } catch {
        const filePath = path.join(
          sourceDir,
          "src",
          "components",
          "sections",
          `${sectionId}.astro`,
        );
        await writeFile(filePath, renderFallbackBlock(ownerSection, designSystem));
        fallbacks.push({ sectionId, page: ownerPage.slug });
        buildLog.push({
          category: "semantics",
          description: `Fell back to deterministic block for section ${sectionId} after astro check failure`,
          page: ownerPage.slug,
        });
      }
    }

    // Second astro check to catch retries that still failed → fall back.
    const errors2 = await runAstroCheck(sourceDir);
    for (const err of errors2) {
      const match = err.file.match(/components\/sections\/([^/]+)\.astro$/);
      const sectionId = match?.[1];
      if (!sectionId) continue;
      let ownerPage: HierarchyPage | undefined;
      let ownerSection: HierarchySection | undefined;
      for (const p of scopedPages) {
        const s = p.sections.find((sec) => sec.id === sectionId);
        if (s) {
          ownerPage = p;
          ownerSection = s;
          break;
        }
      }
      if (!ownerPage || !ownerSection) continue;
      const filePath = path.join(
        sourceDir,
        "src",
        "components",
        "sections",
        `${sectionId}.astro`,
      );
      await writeFile(filePath, renderFallbackBlock(ownerSection, designSystem));
      if (!fallbacks.some((f) => f.sectionId === sectionId && f.page === ownerPage!.slug)) {
        fallbacks.push({ sectionId, page: ownerPage.slug });
        buildLog.push({
          category: "semantics",
          description: `Second astro check failure for section ${sectionId} — using fallback`,
          page: ownerPage.slug,
        });
      }
    }
  }

  if (fallbacks.length > 0) {
    console.log(`[build] ⚠  ${fallbacks.length} section(s) fell back to deterministic block: ${fallbacks.map(f => f.sectionId).join(", ")}`);
  }

  // 7b. Install deps + compile Astro to dist/ so verify can serve the clone.
  // Opt-in: tests skip this because they use synthetic scaffolds without real lockfiles.
  if (input.runAstroBuild) {
    console.log(`[build] running pnpm install + astro build in ${sourceDir}`);
    await runProcess("pnpm", ["install"], sourceDir);
    await runProcess("pnpm", ["exec", "astro", "build"], sourceDir);
    console.log(`[build] astro build complete`);
  }

  // 8. Save updated hierarchy.
  await saveSiteHierarchyDoc(input.db, input.workspaceUuid, input.siteUuid, currentHierarchy);

  // 9. Persist build artifact.
  const artifactPayload = {
    builtPages,
    sharedComponentsBuilt,
    buildLog,
    fallbacks,
  };
  await saveArtifact(input.db, ctx, "build", artifactPayload);

  return {
    builtPages,
    sharedComponentsBuilt,
    buildLog,
    fallbacks,
    sourceDir,
  };
}

async function writeHeaderFooter(sourceDir: string, designSystem: DesignSystemV2): Promise<void> {
  const headerSection = designSystem.global.shell.header ?? makeDefaultHeader(designSystem);
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Header.astro"),
    renderSemanticSection(headerSection),
  );
  await writeFile(
    path.join(sourceDir, "src", "components", "shared", "Footer.astro"),
    renderSemanticSection(designSystem.global.shell.footer ?? makeDefaultFooter(designSystem)),
  );
}
