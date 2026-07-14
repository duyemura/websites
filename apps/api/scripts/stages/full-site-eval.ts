// apps/api/scripts/stages/full-site-eval.ts
// Full-site per-page QA evaluator. Discovers every route in the local Astro dist,
// evaluates each page with Playwright, and aggregates the results.

import { chromium, type Browser } from "playwright";
import { evaluatePage } from "../../src/services/eval/page-evaluator.js";
import { withLocalDistServer } from "../../src/utils/serve-local-dist.js";
import { discoverRoutes } from "../../src/utils/template/route-discovery.js";
import { buildSiteEvalReport } from "../../src/services/eval/page-eval-report.js";
import type { PageEvalReport } from "../../src/services/eval/page-eval-report.js";
import type { StageContext } from "./types";

export interface FullSiteEvalOptions {
  /** Evaluate only these paths. Defaults to all discovered index.html routes. */
  paths?: string[];
  /** Max concurrent Playwright page evaluations. Default 3. */
  concurrency?: number;
  keywords?: string[];
  /** Optional logger override. Defaults to ctx.log. */
  log?: (msg: string) => void;
}

export interface FullSiteEvalResult {
  pages: PageEvalReport[];
  report: ReturnType<typeof buildSiteEvalReport>;
}

async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!, i);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

/**
 * Evaluate every route in the local dist directory.
 * Uses one shared Playwright browser to avoid launching a browser per page.
 */
export async function runFullSiteEval(
  ctx: StageContext,
  distDir: string,
  opts: FullSiteEvalOptions = {},
): Promise<FullSiteEvalResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 3);
  const log = opts.log ?? ctx.log;

  const allRoutes = await discoverRoutes(distDir);
  const paths = opts.paths?.length
    ? opts.paths.filter((p) => allRoutes.includes(p))
    : allRoutes;

  if (paths.length === 0) {
    throw new Error(`No routes found in ${distDir} — run the template stage first`);
  }

  if (paths.length < allRoutes.length) {
    log(`Evaluating ${paths.length} of ${allRoutes.length} routes`);
  } else {
    log(`Evaluating ${paths.length} routes`);
  }

  return withLocalDistServer(distDir, async (baseUrl) => {
    const browser: Browser = await chromium.launch({ args: ["--remote-debugging-port=0"] });
    try {
      const reports = await mapLimit(paths, concurrency, async (path) => {
        const url = path === "/" ? baseUrl : `${baseUrl.replace(/\/$/, "")}${path}`;
        const pageLog = (msg: string) => log(`  [${path}] ${msg}`);
        return evaluatePage({
          db: ctx.db,
          config: ctx.config,
          s3Client: ctx.s3Client,
          siteUuid: ctx.siteUuid,
          workspaceUuid: ctx.workspaceUuid,
          path,
          url,
          keywords: opts.keywords,
          log: pageLog,
          browser,
        });
      });

      return { pages: reports, report: buildSiteEvalReport(reports) };
    } finally {
      await browser.close().catch(() => {});
    }
  });
}
