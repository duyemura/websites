/**
 * Mirror eval harness — run the full mirror pipeline against a real gym URL,
 * then score the deployed mirror against the origin.
 *
 * Usage (from apps/api/):
 *   DOTENV_CONFIG_PATH=../../.env pnpm tsx scripts/eval/run-mirror.ts \
 *     --url https://torrancetraininglab.com \
 *     [--pages 10]     # max pages to screenshot (default 10)
 *
 * Scoring per page:
 *   - Pixel similarity ≥ 95 → PASS  (target ~99; below 95 is a rewriter bug)
 *   - Zero broken same-origin assets (no 4xx/5xx on mirror) → PASS
 *
 * Writes eval-report-mirror-<host>-<timestamp>.md alongside this file.
 */
import "dotenv/config";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

// Apply the tsx __name patch (same as run-pipeline.ts)
const originalLaunch = chromium.launch;
chromium.launch = async function patchedLaunch(...args: Parameters<typeof chromium.launch>) {
  const browser = await originalLaunch.apply(this, args);
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...ctxArgs) => {
    const ctx = await origNewContext(...ctxArgs);
    await ctx.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__name ??= (fn: unknown) => fn;
    });
    return ctx;
  };
  return browser;
} as typeof chromium.launch;

import { db, config } from "../../src/database";
import { buildS3ObjectUrl } from "../../src/s3";
import { runMirrorPipeline } from "../../src/services/mirror/run-mirror";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import { pathToFileKey } from "../../src/services/mirror/snapshot";
import type { MirrorCrawlArtifact } from "../../src/types/mirror";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- CLI ----------

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { args[key] = next; i++; }
  }
  const url = args["url"];
  if (!url) { console.error("Usage: run-mirror.ts --url https://..."); process.exit(1); }
  return { url, maxPages: Number(args["pages"] ?? 10) };
}

// ---------- Bootstrap (mirrors run-pipeline.ts pattern) ----------

async function ensureEvalWorkspace(): Promise<string> {
  const existing = await db
    .selectFrom("workspaces")
    .select("uuid")
    .where("slug", "=", "local")
    .executeTakeFirst();
  if (existing) return existing.uuid;
  const other = await db.selectFrom("workspaces").select("uuid").limit(1).executeTakeFirst();
  if (!other) throw new Error("No workspaces found. Run `pnpm seed` first.");
  return other.uuid;
}

async function ensureEvalSite(workspaceUuid: string, url: string): Promise<string> {
  const { createHash } = await import("crypto");
  const slug = `mirror-eval-${createHash("sha1").update(url).digest("hex").slice(0, 10)}`;
  const existing = await db
    .selectFrom("sites")
    .select("uuid")
    .where("workspaceUuid", "=", workspaceUuid)
    .where("slug", "=", slug)
    .executeTakeFirst();
  if (existing) return existing.uuid;
  const site = await db
    .insertInto("sites")
    .values({
      workspaceUuid,
      name: `Mirror eval: ${new URL(url).hostname}`,
      slug,
      sourceUrl: url,
      status: "draft",
    })
    .returning("uuid")
    .executeTakeFirstOrThrow();
  return site.uuid;
}

// ---------- Screenshot + diff ----------

async function screenshotPage(url: string): Promise<Buffer> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    return await page.screenshot({ fullPage: true });
  } finally {
    await browser.close();
  }
}

function similarity(a: Buffer, b: Buffer): number {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  const width = Math.min(imgA.width, imgB.width);
  const height = Math.min(imgA.height, imgB.height);

  // Crop both to the smaller dimension so pixelmatch doesn't throw on size mismatch
  const cropA = new PNG({ width, height });
  const cropB = new PNG({ width, height });
  PNG.bitblt(imgA, cropA, 0, 0, width, height, 0, 0);
  PNG.bitblt(imgB, cropB, 0, 0, width, height, 0, 0);

  const diffCount = pixelmatch(cropA.data, cropB.data, null, width, height, { threshold: 0.1 });
  return Math.round((1 - diffCount / (width * height)) * 100);
}

// ---------- Broken asset check ----------

interface BrokenAsset { url: string; status: number }

async function countBrokenAssets(pageUrl: string, origin: string): Promise<BrokenAsset[]> {
  const broken: BrokenAsset[] = [];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("response", (res) => {
      try {
        const u = new URL(res.url());
        if (u.origin === new URL(origin).origin && res.status() >= 400) {
          broken.push({ url: res.url(), status: res.status() });
        }
      } catch { /* ignore unparseable URLs */ }
    });
    await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  } finally {
    await browser.close();
  }
  return broken;
}

// ---------- Report ----------

interface PageResult {
  path: string;
  similarity: number;
  brokenAssets: BrokenAsset[];
  formsIntercepted: number;
  warnings: string[];
  pass: boolean;
  error?: string;
}

function renderReport(
  sourceUrl: string,
  siteUuid: string,
  previewBase: string,
  pages: PageResult[],
  durationMs: number,
): string {
  const passCount = pages.filter((p) => p.pass).length;
  const failCount = pages.length - passCount;
  const overallPass = failCount === 0;
  const ts = new Date().toISOString().slice(0, 16).replace("T", " ");

  const lines: string[] = [];
  lines.push(`# Mirror Eval — ${new URL(sourceUrl).hostname}`);
  lines.push("");
  lines.push(`**Date:** ${ts}  `);
  lines.push(`**Source:** ${sourceUrl}  `);
  lines.push(`**Mirror base:** ${previewBase}  `);
  lines.push(`**Site UUID:** \`${siteUuid}\`  `);
  lines.push(`**Duration:** ${(durationMs / 1000).toFixed(1)}s  `);
  lines.push(`**Result:** ${overallPass ? "✅ ALL PASS" : `❌ ${failCount} FAIL`}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Per-page scores");
  lines.push("");
  lines.push("| Path | Similarity | Broken assets | Forms intercepted | Warnings | Result |");
  lines.push("|------|-----------|---------------|-------------------|----------|--------|");
  for (const p of pages) {
    const sim = p.error ? "error" : `${p.similarity}%`;
    const broken = p.error ? "—" : String(p.brokenAssets.length);
    const forms = p.error ? "—" : String(p.formsIntercepted);
    const warn = p.warnings.length > 0 ? p.warnings.join(", ").slice(0, 60) : "—";
    const result = p.error ? `⚠️ ${p.error.slice(0, 50)}` : p.pass ? "✅ PASS" : "❌ FAIL";
    lines.push(`| ${p.path} | ${sim} | ${broken} | ${forms} | ${warn} | ${result} |`);
  }
  lines.push("");

  const failures = pages.filter((p) => !p.pass && !p.error);
  if (failures.length > 0) {
    lines.push("## Failures (similarity < 95 or broken assets > 0)");
    lines.push("");
    for (const p of failures) {
      lines.push(`### ${p.path}`);
      lines.push(`- Similarity: ${p.similarity}%`);
      if (p.brokenAssets.length > 0) {
        lines.push(`- Broken assets (${p.brokenAssets.length}):`);
        for (const b of p.brokenAssets.slice(0, 10)) {
          lines.push(`  - ${b.status} ${b.url}`);
        }
      }
      lines.push("");
    }
  }

  lines.push("## Thresholds");
  lines.push("");
  lines.push("- Similarity ≥ 95 = PASS (below 95 is a rewriter/crawler bug, not tuning)");
  lines.push("- Zero broken same-origin assets = PASS");
  lines.push("");

  return lines.join("\n") + "\n";
}

// ---------- Main ----------

async function main() {
  const { url: sourceUrl, maxPages } = parseArgs(process.argv.slice(2));
  const hostname = new URL(sourceUrl).hostname;
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const reportPath = path.join(__dirname, `eval-report-mirror-${hostname}-${ts}.md`);

  console.log(`\nMirror eval: ${sourceUrl}`);
  console.log(`Report: ${reportPath}\n`);

  const start = Date.now();
  const workspaceUuid = await ensureEvalWorkspace();
  const siteUuid = await ensureEvalSite(workspaceUuid, sourceUrl);
  console.log(`Site UUID: ${siteUuid}`);

  // Stage 1: run the full mirror pipeline
  console.log("\n▶ Running mirror pipeline...");
  let previewUrl: string;
  let deployPrefix: string;
  try {
    const result = await runMirrorPipeline({
      db,
      config,
      siteUuid,
      workspaceUuid,
      log: {
        info: (o, m) => console.log(`  [info] ${m}`, Object.keys(o).length ? o : ""),
        warn: (o, m) => console.warn(`  [warn] ${m}`, Object.keys(o).length ? o : ""),
      },
    });
    previewUrl = result.previewUrl;
    console.log(`  ✓ ${result.pageCount} pages mirrored`);
    if (result.warnings.length > 0) {
      console.log(`  ⚠ ${result.warnings.length} warnings`);
    }
  } catch (err) {
    console.error("✗ Pipeline failed:", err instanceof Error ? err.message : String(err));
    await db.destroy();
    process.exit(1);
  }

  // Load the deploy artifact to get deployPrefix for constructing per-page URLs
  const deployArtifact = await loadArtifact<{
    deployPrefix: string;
    previewUrl: string;
    pageCount: number;
  }>(db, { siteUuid, workspaceUuid }, "mirror-deploy");

  deployPrefix = deployArtifact?.payload.deployPrefix ?? "";

  const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
  function mirrorPageUrl(pagePath: string): string {
    const fileKey = pathToFileKey(pagePath);
    return buildS3ObjectUrl({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket,
      key: `${deployPrefix}/${fileKey}`,
    });
  }

  // Load crawl artifact for the page list and form counts
  const crawlArtifact = await loadArtifact<MirrorCrawlArtifact>(
    db, { siteUuid, workspaceUuid }, "mirror-crawl",
  );
  const crawledPages = crawlArtifact?.payload.pages ?? [];
  const pagesToEval = crawledPages.slice(0, maxPages);
  const crawlWarnings = new Map(
    crawledPages.map((p) => [
      p.path,
      p.dynamicRegions.map((r) => `${r.kind}:${r.evidence.slice(0, 40)}`),
    ]),
  );

  console.log(`\n▶ Scoring ${pagesToEval.length} pages (cap: ${maxPages})...`);
  const mirrorOrigin = new URL(mirrorPageUrl("/")).origin;
  const results: PageResult[] = [];

  for (const page of pagesToEval) {
    const originUrl = `${new URL(sourceUrl).origin}${page.path}`;
    const mirrorUrl = mirrorPageUrl(page.path);
    console.log(`\n  ${page.path}`);
    console.log(`    origin: ${originUrl}`);
    console.log(`    mirror: ${mirrorUrl}`);

    try {
      // Screenshot both in parallel — saves time on slow network pages
      const [originShot, mirrorShot] = await Promise.all([
        screenshotPage(originUrl),
        screenshotPage(mirrorUrl),
      ]);

      const sim = similarity(originShot, mirrorShot);
      const broken = await countBrokenAssets(mirrorUrl, mirrorOrigin);
      const pass = sim >= 95 && broken.length === 0;

      const result: PageResult = {
        path: page.path,
        similarity: sim,
        brokenAssets: broken,
        formsIntercepted: page.forms.length,
        warnings: crawlWarnings.get(page.path) ?? [],
        pass,
      };
      results.push(result);

      console.log(`    similarity=${sim}% broken=${broken.length} forms=${page.forms.length} → ${pass ? "PASS" : "FAIL"}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`    ✗ ${msg}`);
      results.push({
        path: page.path,
        similarity: 0,
        brokenAssets: [],
        formsIntercepted: 0,
        warnings: [],
        pass: false,
        error: msg,
      });
    }
  }

  const durationMs = Date.now() - start;
  const md = renderReport(sourceUrl, siteUuid, previewUrl, results, durationMs);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, md);

  const failCount = results.filter((r) => !r.pass).length;
  console.log(`\n${failCount === 0 ? "✅ ALL PASS" : `❌ ${failCount}/${results.length} FAIL"}`}`);
  console.log(`Report written: ${reportPath}`);

  await db.destroy();
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
