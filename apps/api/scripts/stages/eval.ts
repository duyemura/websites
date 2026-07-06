// apps/api/scripts/stages/eval.ts
import { chromium } from "playwright";
import type { Browser } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { StageRunner, StageContext, StageResult } from "./types";
import { loadArtifact } from "../../src/utils/pipeline/artifact-store";
import type { MirrorCrawlArtifact } from "../../src/types/mirror";

const EVAL_PAGE_LIMIT = 10;
const SIMILARITY_PASS_THRESHOLD = 95;

// ---------- Screenshot helpers ----------

interface PageCapture {
  png: Buffer;
  heightPx: number;
}

/**
 * Screenshot a page — waits for domcontentloaded then networkidle,
 * matching the proven pattern from run-mirror.ts's capturePage.
 *
 * Accepts a shared Browser instance so callers can open one browser for
 * the entire eval run instead of launching a new process per page.
 */
async function screenshotPage(browser: Browser, url: string): Promise<PageCapture> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const status = response?.status() ?? 0;
    if (status >= 400) throw new Error(`HTTP ${status} from ${url}`);
    const png = await page.screenshot({ fullPage: true });
    const img = PNG.sync.read(png);
    return { png, heightPx: img.height };
  } finally {
    await page.close();
  }
}

// ---------- Pixel diff ----------

/**
 * Compute pixel similarity between two PNG screenshots.
 * Crops both images to the smaller dimension (top-aligned) so pixelmatch
 * receives equal-sized buffers — matching the proven approach in run-mirror.ts.
 * Returns similarity 0-100 and the height delta (positive = origin taller).
 */
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

// ---------- CDN path helpers ----------

/**
 * Build the mirror URL for a page. Prefers the subdomain (e.g. ab867633.mygymseo.com)
 * because absolute asset paths like /_assets/main.css must resolve within the same
 * domain via KVS routing. Falls back to the CDN path-based URL if no preview domain
 * is configured. Cache-busted with ?_eval= to bypass CloudFront's 24h HTML cache.
 */
function mirrorUrl(
  cdnBase: string,
  siteUuid: string,
  pagePath: string,
  bust: string,
  previewDomain?: string,
): string {
  const normalised = pagePath === "/" ? "/" : pagePath.replace(/\/$/, "");
  const base = previewDomain
    ? `https://${siteUuid.slice(0, 8)}.${previewDomain}`
    : `${cdnBase.replace(/\/$/, "")}/sites/${siteUuid}`;
  return `${base}${normalised}?_eval=${bust}`;
}

// ---------- Stage ----------

export const evalStage: StageRunner = {
  label: "eval",
  requires: ["mirror-deploy"],
  /** eval never produces a persistent artifact — always re-runs fresh. */
  produces: "",

  async run(ctx: StageContext): Promise<StageResult> {
    // Load mirror-deploy to confirm the pipeline ran and to get the host
    const deployArtifact = await loadArtifact<{ deployPrefix: string; host: string }>(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "mirror-deploy",
    );
    if (!deployArtifact?.payload) throw new Error("mirror-deploy artifact not found — run the mirror stage first");

    // Load crawl artifact for page list
    const crawlArtifact = await loadArtifact<MirrorCrawlArtifact>(
      ctx.db,
      { siteUuid: ctx.siteUuid, workspaceUuid: ctx.workspaceUuid },
      "mirror-crawl",
    );
    const pages = (crawlArtifact?.payload?.pages ?? []).slice(0, EVAL_PAGE_LIMIT);
    if (pages.length === 0) throw new Error("No crawl pages found — run the mirror stage first");

    const site = await ctx.db
      .selectFrom("sites")
      .select("sourceUrl")
      .where("uuid", "=", ctx.siteUuid)
      .executeTakeFirstOrThrow();
    if (!site.sourceUrl) throw new Error("Site has no sourceUrl configured");

    const cdnBase = ctx.config.CDN_BASE_URL;
    const sourceOrigin = new URL(site.sourceUrl).origin;

    const pageWarnings: string[] = [];
    let passCount = 0;
    let totalSimilarity = 0;
    const cacheBust = Date.now().toString(36);

    // ---------- Per-page screenshot + similarity ----------
    // One browser for all pages — avoids spawning a new process per screenshot.

    const browser = await chromium.launch();
    try {
      for (const page of pages) {
        ctx.log(`  Scoring ${page.path} …`);
        try {
          const mirrorPageUrl = mirrorUrl(cdnBase, ctx.siteUuid, page.path, cacheBust, ctx.config.MILO_PREVIEW_DOMAIN);
          const originPageUrl = `${sourceOrigin}${page.path}`;

          // Screenshot origin and mirror in parallel (shared browser, separate pages)
          const [mirrorCapture, originCapture] = await Promise.all([
            screenshotPage(browser, mirrorPageUrl),
            screenshotPage(browser, originPageUrl),
          ]);

          const { score, heightDeltaPx } = computeSimilarity(mirrorCapture.png, originCapture.png);
          totalSimilarity += score;

          if (score >= SIMILARITY_PASS_THRESHOLD) {
            passCount++;
            ctx.log(`    ${score}% similarity — PASS${heightDeltaPx !== 0 ? ` (height Δ ${heightDeltaPx}px)` : ""}`);
          } else {
            pageWarnings.push(
              `${page.path}: similarity ${score}% (below ${SIMILARITY_PASS_THRESHOLD}% threshold, height Δ ${heightDeltaPx}px)`,
            );
            ctx.log(`    ${score}% similarity — FAIL (height Δ ${heightDeltaPx}px)`);
          }
        } catch (err) {
          pageWarnings.push(
            `${page.path}: screenshot failed — ${err instanceof Error ? err.message : String(err)}`,
          );
          ctx.log(`    ERROR: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      await browser.close();
    }

    const avgSimilarity = pages.length > 0 ? Math.round(totalSimilarity / pages.length) : 0;

    // ---------- Form capture smoke test ----------

    let formStatus = "skipped";
    ctx.log("  Form capture smoke test …");
    try {
      // CDN_BASE_URL points at S3/CloudFront static hosting.  The form endpoint
      // lives on the API server, reachable only when CloudFront has an /api/*
      // behaviour rule forwarding to the API origin.  In local dev without
      // CloudFront wired up, 403/404/502 here is expected — it means the static
      // stack is working but the API routing layer is not yet configured.
      const formEndpoint = `${cdnBase.replace(/\/$/, "")}/api/forms/${ctx.siteUuid}/eval-smoke-test`;
      const formRes = await fetch(formEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email: "eval@milotest.com", name: "Eval Test", _hp: "" }),
      });
      if (formRes.status === 201) {
        // Verify the row was actually written
        const row = await ctx.db
          .selectFrom("leads")
          .select("uuid")
          .where("siteUuid", "=", ctx.siteUuid)
          .where("formId", "=", "eval-smoke-test")
          .orderBy("createdAt", "desc")
          .executeTakeFirst();
        if (row) {
          formStatus = "pass";
          // Clean up test lead
          await ctx.db.deleteFrom("leads").where("uuid", "=", row.uuid).execute();
          ctx.log("    Form smoke test — PASS (lead written + cleaned up)");
        } else {
          formStatus = "201 but no row in DB";
          ctx.log("    Form smoke test — WARN: 201 but no row written to leads table");
        }
      } else if (formRes.status === 403 || formRes.status === 404 || formRes.status === 502) {
        formStatus = `⚠️  API not reachable (HTTP ${formRes.status}) — CloudFront /api/* not configured`;
        ctx.log(`    Form smoke test — SKIP (${formStatus})`);
      } else {
        formStatus = `❌ HTTP ${formRes.status}`;
        ctx.log(`    Form smoke test — FAIL (HTTP ${formRes.status})`);
      }
    } catch (err) {
      formStatus = `error: ${err instanceof Error ? err.message : String(err)}`;
      ctx.log(`    Form smoke test — ERROR: ${formStatus}`);
    }

    // ---------- Result ----------

    const anyFailed = passCount < pages.length;

    return {
      stage: "eval",
      status: anyFailed ? "fail" : "pass",
      durationMs: 0,
      metrics: {
        pages: pages.length,
        avgSimilarity: `${avgSimilarity}%`,
        passed: passCount,
        failed: pages.length - passCount,
        form: formStatus,
      },
      warnings: pageWarnings,
    };
  },
};
