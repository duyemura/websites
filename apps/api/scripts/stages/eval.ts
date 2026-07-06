// apps/api/scripts/stages/eval.ts
import { chromium } from "playwright";
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
 */
async function screenshotPage(url: string): Promise<PageCapture> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    const status = response?.status() ?? 0;
    if (status >= 400) throw new Error(`HTTP ${status} from ${url}`);
    const png = await page.screenshot({ fullPage: true });
    const img = PNG.sync.read(png);
    return { png, heightPx: img.height };
  } finally {
    await browser.close();
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
 * Convert a page path to the CDN URL for the promoted current/ version.
 * Mirror pages live at: sites/{siteUuid}/current/{path}/index.html
 * Root maps to: sites/{siteUuid}/current/index.html
 */
function mirrorUrl(cdnBase: string, siteUuid: string, pagePath: string): string {
  const base = cdnBase.replace(/\/$/, "");
  if (pagePath === "/") {
    return `${base}/sites/${siteUuid}/current/index.html`;
  }
  // Normalise: strip trailing slash, add /index.html
  const normalised = pagePath.replace(/\/$/, "");
  return `${base}/sites/${siteUuid}/current${normalised}/index.html`;
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

    // ---------- Per-page screenshot + similarity ----------

    for (const page of pages) {
      ctx.log(`  Scoring ${page.path} …`);
      try {
        const mirrorPageUrl = mirrorUrl(cdnBase, ctx.siteUuid, page.path);
        const originPageUrl = `${sourceOrigin}${page.path}`;

        // Screenshot origin and mirror in parallel
        const [mirrorCapture, originCapture] = await Promise.all([
          screenshotPage(mirrorPageUrl),
          screenshotPage(originPageUrl),
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

    const avgSimilarity = pages.length > 0 ? Math.round(totalSimilarity / pages.length) : 0;

    // ---------- Form capture smoke test ----------

    let formStatus = "skipped";
    ctx.log("  Form capture smoke test …");
    try {
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
      } else {
        formStatus = `HTTP ${formRes.status}`;
        ctx.log(`    Form smoke test — SKIP (HTTP ${formRes.status})`);
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
