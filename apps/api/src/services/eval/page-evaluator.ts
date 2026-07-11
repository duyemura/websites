// apps/api/src/services/eval/page-evaluator.ts
// Standalone per-page QA evaluator for any Milo site.

import { chromium } from "playwright";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import type { GymSiteContent } from "@ploy-gyms/shared-types";
import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import { loadArtifact } from "../../utils/pipeline/artifact-store";
import {
  checkAccessibility,
  checkSeo,
  checkLinks,
  checkInteractivity,
  checkPerformance,
  checkContent,
  checkVisual,
} from "./checks/index.js";
import type { CheckContext } from "./checks/check-context.js";
import type { PageEvalReport } from "./page-eval-report.js";
import { finalizeReport } from "./page-eval-report.js";

export interface PageEvalInput {
  db: Kysely<DB>;
  config: Config;
  s3Client: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  path: string;
  url?: string;
  keywords?: string[];
  log?: (msg: string) => void;
}

function sitePublicUrl(site: {
  subdomain: string | null;
  customDomain: string | null;
  cloudfrontDomain: string | null;
}, config: Config): string | null {
  const previewDomain = config.MILO_PREVIEW_DOMAIN;
  if (site.customDomain) return `https://${site.customDomain}`;
  if (site.subdomain && previewDomain) return `https://${site.subdomain}.${previewDomain}`;
  if (site.cloudfrontDomain) return `https://${site.cloudfrontDomain}`;
  return null;
}

async function loadSite(db: Kysely<DB>, siteUuid: string, workspaceUuid: string) {
  return db
    .selectFrom("sites")
    .select([
      "uuid",
      "workspaceUuid",
      "sourceUrl",
      "subdomain",
      "customDomain",
      "cloudfrontDomain",
      "mode",
      "tier",
      "name",
    ])
    .where("uuid", "=", siteUuid)
    .where("workspaceUuid", "=", workspaceUuid)
    .executeTakeFirst();
}

async function loadGymJson(db: Kysely<DB>, siteUuid: string, workspaceUuid: string): Promise<GymSiteContent | undefined> {
  try {
    const artifact = await loadArtifact(
      db,
      { siteUuid, workspaceUuid },
      "generate" as unknown as Parameters<typeof loadArtifact>[2],
    );
    if (artifact?.payload) return artifact.payload as GymSiteContent;
  } catch {
    // ignore
  }
  return undefined;
}

function normalizePath(path: string): string {
  if (!path || path === "/") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

async function captureMetadata(page: CheckContext["page"], path: string, url: string) {
  const title = await page.title().catch(() => null);
  const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent?.trim() ?? null);
  const text = await page.evaluate(() => {
    const body = document.body;
    if (!body) return "";
    return body.innerText.replace(/\s+/g, " ").trim();
  });
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.loadEventEnd ?? 0;
  });

  return {
    url,
    path,
    title,
    h1,
    wordCount,
    loadTimeMs: Math.round(timing),
  };
}

export async function evaluatePage(input: PageEvalInput): Promise<PageEvalReport> {
  const log = input.log ?? (() => {});
  const site = await loadSite(input.db, input.siteUuid, input.workspaceUuid);
  if (!site) throw new Error("Site not found");

  const publicUrl = sitePublicUrl(site, input.config);
  const path = normalizePath(input.path);
  const url = input.url ?? (publicUrl ? `${publicUrl.replace(/\/$/, "")}${path}` : undefined);
  if (!url) throw new Error("Could not resolve page URL — provide url or configure site domain/subdomain");

  log(`Evaluating ${url}`);

  const content = await loadGymJson(input.db, input.siteUuid, input.workspaceUuid);
  if (content) log("Loaded gym.json for business context");

  const browser = await chromium.launch({
    args: ["--remote-debugging-port=0"],
  });

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();

    const start = Date.now();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    const status = response?.status() ?? 0;
    if (status >= 400) {
      throw new Error(`Page returned HTTP ${status}`);
    }

    const ctx: CheckContext = {
      page,
      browser,
      url,
      path,
      content,
      keywords: input.keywords,
      db: input.db,
      siteUuid: input.siteUuid,
      workspaceUuid: input.workspaceUuid,
      log,
    };

    const [
      accessibility,
      seo,
      links,
      interactivity,
      performance,
      contentResult,
      visual,
    ] = await Promise.all([
      checkAccessibility(ctx),
      checkSeo(ctx),
      checkLinks(ctx),
      checkInteractivity(ctx),
      checkPerformance(ctx),
      checkContent(ctx, input.config),
      checkVisual(ctx, input.config),
    ]);

    const metadata = await captureMetadata(page, path, url);
    metadata.loadTimeMs = Math.max(metadata.loadTimeMs, Date.now() - start);

    return finalizeReport([accessibility, seo, links, interactivity, performance, contentResult, visual], metadata);
  } finally {
    await browser.close().catch(() => {});
  }
}
