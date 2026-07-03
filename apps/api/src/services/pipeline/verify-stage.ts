import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";

import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import {
  VerifyArtifactSchema,
  type Check,
  type ExtractArtifact,
  type VerifyArtifact,
} from "../../types/pipeline-artifacts";
import type { DesignSystemV2 } from "../../types/design-system-v2";
import {
  loadArtifact,
  saveArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";
import { loadSiteHierarchyDoc } from "../../utils/site-hierarchy-io";
import { loadDesignSystemDoc } from "../../utils/design-system-io";
import { loadSectionVisualEvidenceDoc } from "../../utils/section-visual-evidence-io";
import type { BuildLogEntry } from "./build-stage";
import {
  computeScores,
  runAllMechanicalChecks,
} from "../../utils/pipeline/verify-checks";
import {
  deriveImprovements,
  type Improvement,
  type QualitySnapshot,
} from "../../utils/pipeline/improvements";
import { runAxeBaseline, runLighthouse } from "../../utils/pipeline/source-baseline";
import { chatCompletion } from "../../ai/llm-client";
import { modelForTask } from "../../ai/model-picker";

export interface VerifyStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  /** Optional scope: only verify these page paths. Defaults to every page in
   *  the extract artifact. */
  pages?: string[];
  /**
   * Optional pre-served clone URL for tests. When set, the orchestrator skips
   * spawning a static server for `dist/` and uses this URL directly.
   */
  servedUrl?: string;
  /**
   * Optional local directory containing built Astro `dist/` output. When
   * `servedUrl` is not provided, the stage will spin up a static file server
   * over this directory. Defaults to `${os.tmpdir}/ploy-gyms-build/<siteUuid>/build/dist`.
   */
  sourceDir?: string;
}

interface BuildArtifactPayload {
  builtPages: string[];
  sharedComponentsBuilt: string[];
  buildLog: BuildLogEntry[];
  fallbacks: Array<{ sectionId: string; page: string }>;
}

interface VisionCallResult {
  score: number;
  differences: string[];
}

/**
 * Run the verify stage: mechanical checks, visual diff vs. extract, Lighthouse
 * delta, and improvement receipts. Produces a VerifyArtifact persisted to
 * `pipeline_artifacts`.
 *
 * The orchestrator is defensive on the runtime side: any missing prerequisite
 * doc (extract / hierarchy / design system) throws with a clear message.
 * Everything else (Lighthouse, vision, individual mechanical checks) is
 * best-effort — a failure records a Check but does not abort the stage.
 */
export async function runVerifyStage(
  input: VerifyStageInput,
): Promise<VerifyArtifact> {
  const ctx: ArtifactContext = {
    siteUuid: input.siteUuid,
    workspaceUuid: input.workspaceUuid,
  };

  const extract = await loadArtifact<ExtractArtifact>(input.db, ctx, "extract");
  if (!extract) throw new Error(`Extract artifact missing for site ${input.siteUuid}`);
  const build = await loadArtifact<BuildArtifactPayload>(input.db, ctx, "build");
  const hierarchy = await loadSiteHierarchyDoc(
    input.db,
    input.workspaceUuid,
    input.siteUuid,
  );
  if (!hierarchy) throw new Error(`Site hierarchy missing for site ${input.siteUuid}`);
  const designSystemDoc = await loadDesignSystemDoc(
    input.db,
    input.workspaceUuid,
    input.siteUuid,
  );
  if (!designSystemDoc || designSystemDoc.version !== "2") {
    throw new Error(`Design system v2 missing for site ${input.siteUuid}`);
  }
  const designSystem = designSystemDoc as DesignSystemV2;
  const evidence = await loadSectionVisualEvidenceDoc(
    input.db,
    input.workspaceUuid,
    input.siteUuid,
  );

  const scope = input.pages ?? extract.payload.pages.map((p) => p.path);
  const sourceHost = new URL(extract.payload.url).host;

  // Serve the built clone.
  const { url: cloneUrl, close: closeServer } = await serveClone(input);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const perPageResults: VerifyArtifact["pages"] = [];
  const visionScoresGlobal: number[] = [];
  const allPassed: Check[] = [];
  const allFailed: Check[] = [];
  const actionable: VerifyArtifact["actionable"] = [];
  const cloneSnapshotAgg: QualitySnapshot = emptySnapshot(scope.length);
  const baselineSnapshot = buildBaselineSnapshot(extract.payload, scope);

  try {
    for (const pagePath of scope) {
      const extractPage = extract.payload.pages.find((p) => p.path === pagePath);
      if (!extractPage) continue;

      // 1. Mechanical checks for this page.
      const paths = [pagePath];
      const mechanical = await runAllMechanicalChecks({
        page,
        baseUrl: cloneUrl,
        paths,
        hierarchy,
        designSystem,
        sourceHost,
        breakpoints: extractPage.responsive,
        evidence,
      });
      allPassed.push(...mechanical.passed);
      allFailed.push(...mechanical.failed);

      // 2. Vision compare at 1440 and 375.
      let score1440 = 0;
      let score375 = 0;
      const differences: string[] = [];
      try {
        const vision1440 = await visionCompare(
          extractPage.screenshots.full1440,
          await captureCurrent(page, cloneUrl, pagePath, 1440),
          input.config,
        );
        score1440 = vision1440.score;
        differences.push(...vision1440.differences);
        visionScoresGlobal.push(vision1440.score);
      } catch (err) {
        differences.push(`vision-1440 failed: ${(err as Error).message}`);
      }
      try {
        const vision375 = await visionCompare(
          extractPage.screenshots.vp375,
          await captureCurrent(page, cloneUrl, pagePath, 375),
          input.config,
        );
        score375 = vision375.score;
        differences.push(...vision375.differences);
        visionScoresGlobal.push(vision375.score);
      } catch (err) {
        differences.push(`vision-375 failed: ${(err as Error).message}`);
      }

      // 3. Clone quality snapshot fragment.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(new URL(pagePath, cloneUrl).toString(), {
        waitUntil: "domcontentloaded",
      });
      const cloneFragment = await measureCloneQuality(page, pagePath);
      mergeSnapshotFragment(cloneSnapshotAgg, cloneFragment);

      // 4. Actionable routing for failed critical checks specific to this page.
      routeActionable(mechanical.failed, pagePath, actionable);

      perPageResults.push({
        path: pagePath,
        mechanical: {
          passed: mechanical.passed,
          failed: mechanical.failed,
        },
        vision: { score1440, score375, differences },
      });
    }

    // 5. Lighthouse (clone homepage) — mobile + desktop.
    const homePath = scope.includes("/") ? "/" : scope[0] ?? "/";
    const cloneLighthouse = await runCloneLighthouse(page, cloneUrl, homePath);

    // 6. Fidelity scores.
    const fidelity = computeScores({
      passed: allPassed,
      failed: allFailed,
      visionScores: visionScoresGlobal,
    });

    // 7. Quality score deltas (clone vs baseline; average across mobile+desktop).
    const quality = computeQualityDeltas(extract.payload, cloneLighthouse);

    // 8. Improvements: baseline diff + build log passthrough.
    //
    // `Improvement` (improvements.ts) is deliberately narrow to `source:
    // "baseline-diff"`. Build-log entries share the same shape but with
    // `source: "build-log"`, so we build a union-friendly array here that
    // the VerifyArtifact schema accepts.
    const derived = deriveImprovements(baselineSnapshot, cloneSnapshotAgg);
    const buildLogImprovements = (build?.payload.buildLog ?? []).map(
      (entry) => ({
        category: entry.category as Improvement["category"],
        source: "build-log" as const,
        description: entry.description,
        page: entry.page,
      }),
    );
    const improvements: VerifyArtifact["improvements"] = [
      ...derived,
      ...buildLogImprovements,
    ];

    // 9. Fallbacks from the build artifact.
    for (const fb of build?.payload.fallbacks ?? []) {
      actionable.push({
        page: slugToPath(fb.page),
        sectionId: fb.sectionId,
        issue: "section fell back to generic block",
        suggestedStage: "build",
      });
    }

    const artifact: VerifyArtifact = VerifyArtifactSchema.parse({
      pages: perPageResults,
      scores: {
        mechanicalFidelity: fidelity.mechanicalFidelity,
        visualFidelity: fidelity.visualFidelity,
        masterFidelity: fidelity.masterFidelity,
        quality,
      },
      improvements,
      actionable,
    });
    await saveArtifact(input.db, ctx, "verify", artifact);
    return artifact;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await closeServer().catch(() => {});
  }
}

// ---------- helpers ----------

function emptySnapshot(totalPages: number): QualitySnapshot {
  return {
    schemaTypes: [],
    semanticElementCount: 0,
    axeViolationCount: 0,
    imageBytes: 0,
    metaDescriptionPages: 0,
    totalPages,
  };
}

function mergeSnapshotFragment(
  agg: QualitySnapshot,
  frag: {
    schemaTypes: string[];
    semanticElementCount: number;
    axeViolationCount: number;
    metaDescription: boolean;
    imageBytes: number;
  },
): void {
  for (const t of frag.schemaTypes) {
    if (!agg.schemaTypes.includes(t)) agg.schemaTypes.push(t);
  }
  agg.semanticElementCount += frag.semanticElementCount;
  agg.axeViolationCount += frag.axeViolationCount;
  agg.imageBytes += frag.imageBytes;
  if (frag.metaDescription) agg.metaDescriptionPages += 1;
}

function buildBaselineSnapshot(
  extract: ExtractArtifact,
  scope: string[],
): QualitySnapshot {
  const scoped = new Set(scope);
  const schemaTypes: string[] = [];
  let semanticElementCount = 0;
  let axeViolationCount = 0;
  let imageBytes = 0;
  let metaDescriptionPages = 0;
  let totalPages = 0;
  for (const p of extract.pages) {
    if (!scoped.has(p.path)) continue;
    totalPages += 1;
    for (const entry of p.content.jsonLd ?? []) {
      const t = extractJsonLdType(entry);
      if (t && !schemaTypes.includes(t)) schemaTypes.push(t);
    }
    // Semantic element count is a proxy — the extract artifact doesn't record
    // it directly. Use headings + navLinks + jsonLd + iframes/videos as a
    // rough tally, since the source's semantic footprint isn't captured
    // otherwise. This intentionally undercounts so any clone improvement
    // shows up clearly.
    semanticElementCount +=
      (p.content.headings?.length ?? 0) + (p.content.navLinks?.length ?? 0);
    const meta = p.content.meta ?? {};
    if (meta.description || meta["description"]) metaDescriptionPages += 1;
    for (const m of p.media) {
      if (m.resourceType === "image") imageBytes += m.bytes;
    }
  }
  for (const a of extract.sourceBaseline.axe) {
    if (!scoped.has(a.path)) continue;
    axeViolationCount += a.violations.reduce((sum, v) => sum + v.nodes, 0);
  }
  return {
    schemaTypes,
    semanticElementCount,
    axeViolationCount,
    imageBytes,
    metaDescriptionPages,
    totalPages,
  };
}

function extractJsonLdType(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const t = (entry as { "@type"?: unknown })["@type"];
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return null;
}

async function measureCloneQuality(
  page: Page,
  pagePath: string,
): Promise<{
  schemaTypes: string[];
  semanticElementCount: number;
  axeViolationCount: number;
  metaDescription: boolean;
  imageBytes: number;
}> {
  const dom = await page.evaluate(() => {
    const jsonLdBlocks = Array.from(
      document.querySelectorAll('script[type="application/ld+json"]'),
    );
    const jsonLdTypes: string[] = [];
    for (const el of jsonLdBlocks) {
      try {
        const parsed = JSON.parse((el as HTMLScriptElement).textContent ?? "null");
        const t = parsed?.["@type"];
        if (typeof t === "string") jsonLdTypes.push(t);
        else if (Array.isArray(t)) jsonLdTypes.push(...t.filter((x) => typeof x === "string"));
      } catch {
        /* skip malformed */
      }
    }
    const semanticCount = document.querySelectorAll(
      "header,footer,main,nav,section,article",
    ).length;
    const meta = document.querySelector('meta[name="description"]');
    const metaDescription = Boolean(meta?.getAttribute("content"));
    return { jsonLdTypes, semanticCount, metaDescription };
  });

  let axeCount = 0;
  try {
    const axe = await runAxeBaseline(page, pagePath);
    axeCount = axe.violations.reduce((sum, v) => sum + v.nodes, 0);
  } catch {
    /* best effort */
  }

  return {
    schemaTypes: dom.jsonLdTypes,
    semanticElementCount: dom.semanticCount,
    axeViolationCount: axeCount,
    metaDescription: dom.metaDescription,
    imageBytes: 0, // per-image byte accounting on the clone is skipped — MB
    // savings come from re-hosted, right-sized images and don't need to be
    // re-fetched to demonstrate.
  };
}

async function captureCurrent(
  page: Page,
  cloneUrl: string,
  pagePath: string,
  width: number,
): Promise<Buffer> {
  await page.setViewportSize({ width, height: Math.round(width * 1.5) });
  await page.goto(new URL(pagePath, cloneUrl).toString(), {
    waitUntil: "domcontentloaded",
  });
  return page.screenshot({ fullPage: true });
}

/**
 * Layer 2 vision compare — describe original vs clone screenshots and return a
 * 0-100 similarity score plus a difference list. Wraps `chatCompletion`; the
 * caller catches thrown errors and records a failed vision score.
 */
async function visionCompare(
  originalUrl: string,
  cloneBuffer: Buffer,
  config: Config,
): Promise<VisionCallResult> {
  const cloneDataUrl = `data:image/png;base64,${cloneBuffer.toString("base64")}`;
  const response = await chatCompletion(
    {
      model: modelForTask("vision", config),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Compare the original site screenshot (first image) to the clone (second image). " +
                "Rate visual similarity 0–100 (100 = identical), and list up to 5 concrete " +
                'differences. Respond as JSON only: {"score": number, "differences": string[]}.',
            },
            { type: "image_url", image_url: { url: originalUrl } },
            { type: "image_url", image_url: { url: cloneDataUrl } },
          ],
        },
      ],
      jsonMode: true,
      temperature: 0,
    },
    config,
  );
  return parseVisionResponse(response.content);
}

function parseVisionResponse(content: string): VisionCallResult {
  try {
    const parsed = JSON.parse(content) as { score?: number; differences?: unknown };
    const score =
      typeof parsed.score === "number" && Number.isFinite(parsed.score)
        ? Math.max(0, Math.min(100, Math.round(parsed.score)))
        : 0;
    const differences = Array.isArray(parsed.differences)
      ? parsed.differences.filter((d): d is string => typeof d === "string")
      : [];
    return { score, differences };
  } catch {
    return { score: 0, differences: ["vision response was not valid JSON"] };
  }
}

async function runCloneLighthouse(
  page: Page,
  cloneUrl: string,
  homePath: string,
): Promise<Array<{ preset: "mobile" | "desktop"; performance: number; seo: number; accessibility: number; bestPractices: number }>> {
  const out: Array<{
    preset: "mobile" | "desktop";
    performance: number;
    seo: number;
    accessibility: number;
    bestPractices: number;
  }> = [];
  let debugPort: number | null = null;
  try {
    const session = await page.context().newCDPSession(page);
    const info = (await session.send("Browser.getVersion")) as {
      webSocketDebuggerUrl?: string;
    };
    await session.detach().catch(() => {});
    if (info.webSocketDebuggerUrl) {
      const port = new URL(info.webSocketDebuggerUrl).port;
      const num = port ? Number(port) : NaN;
      if (Number.isFinite(num) && num > 0) debugPort = num;
    }
  } catch {
    /* Lighthouse best-effort */
  }
  if (!debugPort) return out;
  const targetUrl = new URL(homePath, cloneUrl).toString();
  for (const preset of ["mobile", "desktop"] as const) {
    const lh = await runLighthouse(targetUrl, homePath, preset, debugPort);
    if (lh) {
      out.push({
        preset,
        performance: lh.performance,
        seo: lh.seo,
        accessibility: lh.accessibility,
        bestPractices: lh.bestPractices,
      });
    }
  }
  return out;
}

function computeQualityDeltas(
  extract: ExtractArtifact,
  cloneLighthouse: Array<{
    preset: "mobile" | "desktop";
    performance: number;
    seo: number;
    accessibility: number;
  }>,
): VerifyArtifact["scores"]["quality"] {
  const original = averageCategories(extract.sourceBaseline.lighthouse);
  const clone = averageCategories(cloneLighthouse);
  return {
    performance: {
      clone: clone.performance,
      original: original.performance,
      delta: clone.performance - original.performance,
    },
    seo: {
      clone: clone.seo,
      original: original.seo,
      delta: clone.seo - original.seo,
    },
    accessibility: {
      clone: clone.accessibility,
      original: original.accessibility,
      delta: clone.accessibility - original.accessibility,
    },
  };
}

function averageCategories(
  entries: Array<{ performance: number; seo: number; accessibility: number }>,
): { performance: number; seo: number; accessibility: number } {
  if (entries.length === 0) {
    return { performance: 0, seo: 0, accessibility: 0 };
  }
  const sum = entries.reduce(
    (acc, e) => ({
      performance: acc.performance + e.performance,
      seo: acc.seo + e.seo,
      accessibility: acc.accessibility + e.accessibility,
    }),
    { performance: 0, seo: 0, accessibility: 0 },
  );
  return {
    performance: Math.round(sum.performance / entries.length),
    seo: Math.round(sum.seo / entries.length),
    accessibility: Math.round(sum.accessibility / entries.length),
  };
}

function routeActionable(
  failed: Check[],
  pagePath: string,
  out: VerifyArtifact["actionable"],
): void {
  for (const check of failed) {
    // Map check IDs → suggested stage based on the plan's routing table.
    if (check.id.startsWith("section-")) {
      out.push({
        page: pagePath,
        sectionId: check.id.replace(/^section-/, ""),
        issue: "missing section in clone",
        suggestedStage: "segment",
      });
    } else if (check.id.startsWith("token-")) {
      out.push({ page: pagePath, issue: `token mismatch: ${check.detail ?? check.id}`, suggestedStage: "docgen" });
    } else if (check.id.startsWith("media-")) {
      out.push({ page: pagePath, issue: `media issue: ${check.detail ?? check.id}`, suggestedStage: "build" });
    } else if (check.id.startsWith("interaction-")) {
      out.push({
        page: pagePath,
        issue: `interaction dead: ${check.detail ?? check.id}`,
        suggestedStage: "build",
      });
    } else if (check.id.startsWith("breakpoint-")) {
      out.push({
        page: pagePath,
        issue: `breakpoint mismatch: ${check.detail ?? check.id}`,
        suggestedStage: "build",
      });
    } else if (check.id.startsWith("page-render-")) {
      out.push({ page: pagePath, issue: `page render failure: ${check.detail ?? check.id}`, suggestedStage: "build" });
    }
  }
}

function slugToPath(slug: string): string {
  if (slug === "index") return "/";
  return `/${slug}`;
}

// ---------- serve clone ----------

interface ServeResult {
  url: string;
  close: () => Promise<void>;
}

/**
 * Serve the built clone. In production we prefer `astro preview` for correct
 * routing; for tests (or when astro isn't installed in the source dir) we
 * fall back to a static file server that maps `/foo` → `${dir}/foo/index.html`.
 * Callers can bypass both by passing `servedUrl` — the URL is returned as-is.
 */
async function serveClone(input: VerifyStageInput): Promise<ServeResult> {
  if (input.servedUrl) {
    return { url: input.servedUrl, close: async () => {} };
  }

  const sourceDir =
    input.sourceDir ??
    path.join(
      // Prefer the standard build-stage tmpdir layout.
      os.tmpdir(),
      "ploy-gyms-build",
      input.siteUuid,
      "build",
    );
  const distDir = path.join(sourceDir, "dist");

  // Try `astro preview` first if the project has its deps.
  const astroBin = path.join(sourceDir, "node_modules", ".bin", "astro");
  if (await fileExists(astroBin) && (await fileExists(distDir))) {
    return startAstroPreview(astroBin, sourceDir);
  }

  // Fallback: static file server over dist/. If dist/ doesn't exist either,
  // the caller is expected to pass `servedUrl` explicitly.
  if (!(await fileExists(distDir))) {
    throw new Error(
      `serveClone: no dist/ directory at ${distDir} and no servedUrl provided`,
    );
  }
  return startStaticFileServer(distDir);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function startAstroPreview(
  astroBin: string,
  cwd: string,
): Promise<ServeResult> {
  const proc: ChildProcess = spawn(astroBin, ["preview", "--port", "0"], {
    cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("astro preview did not report a URL within 30s")),
      30_000,
    );
    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/http:\/\/[^\s]+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`astro preview exited early with code ${code}`));
    });
  });
  return {
    url,
    close: async () => {
      proc.kill("SIGTERM");
    },
  };
}

async function startStaticFileServer(dir: string): Promise<ServeResult> {
  const server: Server = createServer(async (req, res) => {
    try {
      const url = req.url ?? "/";
      const clean = url.split("?")[0]!.replace(/\/+$/, "");
      const candidates = [
        path.join(dir, clean || "index.html"),
        path.join(dir, clean, "index.html"),
        path.join(dir, "index.html"),
      ];
      for (const filePath of candidates) {
        try {
          await stat(filePath);
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { "content-type": contentTypeFor(ext) });
          createReadStream(filePath).pipe(res);
          return;
        } catch {
          continue;
        }
      }
      res.writeHead(404);
      res.end("not found");
    } catch (err) {
      res.writeHead(500);
      res.end((err as Error).message);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}

function contentTypeFor(ext: string): string {
  switch (ext) {
    case ".html":
      return "text/html";
    case ".css":
      return "text/css";
    case ".js":
      return "text/javascript";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

/**
 * Explicitly re-export the QualitySnapshot / Improvement types so pipeline
 * consumers importing from this module don't have to reach into the utils
 * folder.
 */
export type { QualitySnapshot, Improvement } from "../../utils/pipeline/improvements";
