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
// Also load root .env for DB/Redis vars not present in apps/api/.env
import { configDotenv } from "dotenv";
import { resolve } from "path";
configDotenv({ path: resolve(import.meta.dirname, "../../../../.env"), override: false });
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
import { CRAWL_TIER_FREE, CRAWL_TIER_PAID } from "../../src/types/mirror";

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
  if (!url) { console.error("Usage: run-mirror.ts --url https://... [--pages N] [--tier free|paid]"); process.exit(1); }

  const pagesRaw = Number(args["pages"] ?? 10);
  const maxPages = Number.isFinite(pagesRaw) && pagesRaw > 0 ? pagesRaw : 10;

  // Default to paid tier for eval runs — free tier (20 pages) is a product limit,
  // not a dev constraint. Pass --tier free to test the free tier experience.
  const tier = args["tier"] === "free" ? "free" : "paid";

  return { url, maxPages, tier: tier as "free" | "paid" };
}

// ---------- Bootstrap ----------

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

// ---------- Screenshot + broken-asset check in one browser pass ----------

interface BrokenAsset { url: string; status: number }

interface PageCapture {
  png: Buffer;
  brokenAssets: BrokenAsset[];
  heightPx: number;
}

/**
 * Screenshot a page and simultaneously collect broken same-origin asset
 * responses — done in a single browser launch to avoid the double-navigation
 * cost of a separate broken-asset pass. (I1)
 */
async function capturePage(pageUrl: string, sameOrigin: string): Promise<PageCapture> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const broken: BrokenAsset[] = [];

    page.on("response", (res) => {
      try {
        if (new URL(res.url()).origin === sameOrigin && res.status() >= 400) {
          broken.push({ url: res.url(), status: res.status() });
        }
      } catch { /* ignore unparseable URLs */ }
    });

    const response = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

    // C2: throw on HTTP error so callers get a clear failure, not a
    // screenshot of an S3 XML error page that looks like a "rewriter bug"
    const status = response?.status() ?? 0;
    if (status >= 400) throw new Error(`HTTP ${status} from ${pageUrl}`);

    const png = await page.screenshot({ fullPage: true });
    const img = PNG.sync.read(png);
    return { png, brokenAssets: broken, heightPx: img.height };
  } finally {
    await browser.close();
  }
}

/** Screenshot the origin page — no broken-asset tracking needed. */
async function screenshotOrigin(pageUrl: string): Promise<{ png: Buffer; heightPx: number }> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const response = await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const status = response?.status() ?? 0;
    if (status >= 400) throw new Error(`HTTP ${status} from ${pageUrl}`);
    const png = await page.screenshot({ fullPage: true });
    const img = PNG.sync.read(png);
    return { png, heightPx: img.height };
  } finally {
    await browser.close();
  }
}

// ---------- Pixel diff ----------

function computeSimilarity(a: Buffer, b: Buffer): { score: number; heightDeltaPx: number } {
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);

  const width = Math.min(imgA.width, imgB.width);
  const height = Math.min(imgA.height, imgB.height);

  // Crop both to the smaller dimension for pixelmatch (top-aligned crop)
  const cropA = new PNG({ width, height });
  const cropB = new PNG({ width, height });
  PNG.bitblt(imgA, cropA, 0, 0, width, height, 0, 0);
  PNG.bitblt(imgB, cropB, 0, 0, width, height, 0, 0);

  const diffCount = pixelmatch(cropA.data, cropB.data, null, width, height, { threshold: 0.1 });
  const score = Math.round((1 - diffCount / (width * height)) * 100);
  const heightDeltaPx = imgA.height - imgB.height; // positive = origin taller than mirror

  return { score, heightDeltaPx };
}

// ---------- Report ----------

interface PageResult {
  path: string;
  similarity: number;
  heightDeltaPx: number;
  brokenAssets: BrokenAsset[];
  formsDetectedAtCrawl: number;
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
  // I4: renamed column to reflect what it actually measures
  lines.push("| Path | Similarity | Height Δ (px) | Broken assets | Forms (crawl) | Warnings | Result |");
  lines.push("|------|-----------|--------------|---------------|--------------|----------|--------|");
  for (const p of pages) {
    const sim = p.error ? "error" : `${p.similarity}%`;
    const delta = p.error ? "—" : (p.heightDeltaPx >= 0 ? `+${p.heightDeltaPx}` : String(p.heightDeltaPx));
    const broken = p.error ? "—" : String(p.brokenAssets.length);
    const forms = p.error ? "—" : String(p.formsDetectedAtCrawl);
    const warn = p.warnings.length > 0 ? p.warnings.join(", ").slice(0, 60) : "—";
    const result = p.error
      ? `⚠️ ${p.error.slice(0, 50)}`
      : p.pass ? "✅ PASS" : "❌ FAIL";
    lines.push(`| ${p.path} | ${sim} | ${delta} | ${broken} | ${forms} | ${warn} | ${result} |`);
  }
  lines.push("");
  lines.push("> Height Δ = origin height minus mirror height in pixels. Negative means mirror is taller.");
  lines.push("");

  const failures = pages.filter((p) => !p.pass && !p.error);
  if (failures.length > 0) {
    lines.push("## Failures (similarity < 95 or broken assets > 0)");
    lines.push("");
    for (const p of failures) {
      lines.push(`### ${p.path}`);
      lines.push(`- Similarity: ${p.similarity}% (height Δ: ${p.heightDeltaPx}px)`);
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
  lines.push("- Large height Δ with high similarity = missing section not caught by pixel diff — investigate manually");
  lines.push("");

  return lines.join("\n") + "\n";
}

// ---------- Main ----------

async function main() {
  const { url: sourceUrl, maxPages, tier: tierName } = parseArgs(process.argv.slice(2));
  const crawlTier = tierName === "free" ? CRAWL_TIER_FREE : CRAWL_TIER_PAID;
  const hostname = new URL(sourceUrl).hostname;
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const reportPath = path.join(__dirname, `eval-report-mirror-${hostname}-${ts}.md`);

  console.log(`\nMirror eval: ${sourceUrl}`);
  console.log(`Report: ${reportPath}\n`);

  const start = Date.now();

  // I2: top-level cleanup ensures db + any leaked browsers are handled on any exit path
  const cleanup = async () => { try { await db.destroy(); } catch { /* ignore */ } };

  try {
    const workspaceUuid = await ensureEvalWorkspace();
    const siteUuid = await ensureEvalSite(workspaceUuid, sourceUrl);
    console.log(`Site UUID: ${siteUuid}`);

    // Stage 1: run the full mirror pipeline
    console.log("\n▶ Running mirror pipeline...");
    console.log(`  Tier: ${tierName} (${crawlTier.maxCapturedPages === Infinity ? "unlimited" : crawlTier.maxCapturedPages + " pages max"}, UGC skip: ${crawlTier.skipUgcCapture})`);
    const mirrorResult = await runMirrorPipeline({
      db,
      config,
      siteUuid,
      workspaceUuid,
      tier: crawlTier,
      log: {
        info: (o, m) => console.log(`  [info] ${m}`, o && Object.keys(o).length ? o : ""),
        warn: (o, m) => console.warn(`  [warn] ${m}`, o && Object.keys(o).length ? o : ""),
      },
    });
    console.log(`  ✓ ${mirrorResult.pageCount} pages mirrored`);
    if (mirrorResult.warnings.length > 0) console.log(`  ⚠ ${mirrorResult.warnings.length} warnings`);

    // Load artifacts for per-page URL construction and form counts
    const deployArtifact = await loadArtifact<{ deployPrefix: string; previewUrl: string }>(
      db, { siteUuid, workspaceUuid }, "mirror-deploy",
    );
    const deployPrefix = deployArtifact?.payload.deployPrefix ?? "";
    // Use CloudFront URL as the preview base — S3 direct URL has path-resolution issues
    const previewUrl = `${config.CDN_BASE_URL.replace(/\/+$/, "")}/`;

    const bucket = config.S3_DEPLOYMENTS_BUCKET ?? config.S3_ASSETS_BUCKET;
    if (!bucket) throw new Error("S3_ASSETS_BUCKET is not configured");

    // Use CloudFront (CDN_BASE_URL) so /_assets/ paths resolve correctly.
    // CloudFront routes by hostname via KVS → sites/{uuid}/current/
    // The raw S3 deploy URL has path-resolution failures because /_assets/ resolves
    // to the bucket root rather than the deploy prefix.
    const cdnBase = config.CDN_BASE_URL.replace(/\/+$/, "");
    function mirrorPageUrl(pagePath: string): string {
      return `${cdnBase}${pagePath === "/" ? "/" : pagePath}`;
    }

    const crawlArtifact = await loadArtifact<MirrorCrawlArtifact>(
      db, { siteUuid, workspaceUuid }, "mirror-crawl",
    );
    const crawledPages = crawlArtifact?.payload.pages ?? [];
    const pagesToEval = crawledPages.slice(0, maxPages);

    if (pagesToEval.length === 0) {
      console.error("No pages in crawl artifact — did the mirror pipeline complete?");
      await cleanup();
      process.exit(1);
    }

    const crawlWarnings = new Map(
      crawledPages.map((p) => [
        p.path,
        p.dynamicRegions.map((r) => `${r.kind}:${r.evidence.slice(0, 40)}`),
      ]),
    );

    // Mirror origin for same-origin broken-asset filtering
    const mirrorOrigin = new URL(mirrorPageUrl("/")).origin;

    console.log(`\n▶ Scoring ${pagesToEval.length} pages (cap: ${maxPages})...`);
    const results: PageResult[] = [];

    for (const page of pagesToEval) {
      const originUrl = `${new URL(sourceUrl).origin}${page.path}`;
      const mUrl = mirrorPageUrl(page.path);
      console.log(`\n  ${page.path}`);

      try {
        // Screenshot origin and mirror in parallel (I1: mirror also collects broken assets)
        const [originCapture, mirrorCapture] = await Promise.all([
          screenshotOrigin(originUrl),
          capturePage(mUrl, mirrorOrigin),
        ]);

        const { score, heightDeltaPx } = computeSimilarity(originCapture.png, mirrorCapture.png);
        const pass = score >= 95 && mirrorCapture.brokenAssets.length === 0;

        results.push({
          path: page.path,
          similarity: score,
          heightDeltaPx,
          brokenAssets: mirrorCapture.brokenAssets,
          formsDetectedAtCrawl: page.forms.length,
          warnings: crawlWarnings.get(page.path) ?? [],
          pass,
        });

        console.log(`  similarity=${score}% Δheight=${heightDeltaPx}px broken=${mirrorCapture.brokenAssets.length} → ${pass ? "PASS" : "FAIL"}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ ${msg}`);
        results.push({
          path: page.path,
          similarity: 0,
          heightDeltaPx: 0,
          brokenAssets: [],
          formsDetectedAtCrawl: page.forms.length,
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
    // C1: fixed template literal syntax
    console.log(`\n${failCount === 0 ? "✅ ALL PASS" : `❌ ${failCount}/${results.length} FAIL`}`);
    console.log(`Report: ${reportPath}`);

    // Form capture smoke-test: POST a test lead, assert 201 + row lands in DB
    console.log("\n## Form capture check");
    try {
      const formRes = await fetch(
        `${cdnBase}/api/forms/${siteUuid}/eval-smoke-test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email: "eval@milotest.com", name: "Eval Test", _hp: "" }),
        },
      );
      if (formRes.status === 201) {
        const row = await db
          .selectFrom("leads")
          .select("uuid")
          .where("siteUuid", "=", siteUuid)
          .where("formId", "=", "eval-smoke-test")
          .where("email", "=", "eval@milotest.com")
          .orderBy("createdAt", "desc")
          .executeTakeFirst();
        if (row) {
          console.log("✅ Form capture: lead stored (uuid:", row.uuid, ")");
          await db.deleteFrom("leads").where("uuid", "=", row.uuid).execute();
        } else {
          console.log("❌ Form capture: 201 but lead row not found in DB");
        }
      } else {
        console.log(`❌ Form capture: expected 201, got ${formRes.status}`);
      }
    } catch (err) {
      console.log("❌ Form capture: fetch failed —", err instanceof Error ? err.message : String(err));
    }

    await cleanup();
    process.exit(failCount > 0 ? 1 : 0);
  } catch (err) {
    console.error("\n✗ Eval failed:", err instanceof Error ? err.message : String(err));
    await cleanup();
    process.exit(1);
  }
}

main();
