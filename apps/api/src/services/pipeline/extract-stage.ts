import { chromium, type BrowserContext, type Page } from "playwright";
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";

import type { DB } from "../../types/db";
import type { Config } from "../../plugins/env";
import {
  ExtractArtifactSchema,
  type ExtractArtifact,
} from "../../types/pipeline-artifacts";
import {
  buildSiteMap,
  type DiscoveryInputs,
} from "../../utils/pipeline/page-discovery";
import { capturePage } from "../../utils/pipeline/capture-page";
import { extractCss } from "../../utils/pipeline/css-extraction";
import { captureInteractions } from "../../utils/pipeline/interaction-capture";
import {
  runAxeBaseline,
  runLighthouse,
  networkStatsFromCapture,
} from "../../utils/pipeline/source-baseline";
import {
  saveArtifact,
  loadArtifact,
  type ArtifactContext,
} from "../../utils/pipeline/artifact-store";
import { uploadPipelineImage } from "../../utils/pipeline/s3-upload";

export interface ExtractStageInput {
  db: Kysely<DB>;
  config: Config;
  s3: S3Client;
  siteUuid: string;
  workspaceUuid: string;
  url: string;
  pages?: string[];
  maxPages?: number;
}

const DEFAULT_MAX_PAGES = 50;
const LIGHTHOUSE_PAGE_CAP = 10;

export async function runExtractStage(
  input: ExtractStageInput,
): Promise<ExtractArtifact> {
  const ctx: ArtifactContext = {
    siteUuid: input.siteUuid,
    workspaceUuid: input.workspaceUuid,
  };

  const browser = await chromium.launch({
    args: ["--remote-debugging-port=0"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  try {
    // ---- discovery ----
    const discovery = await discoverPages(context, input.url);
    const siteMap = buildSiteMap(discovery, {
      maxPages: input.maxPages ?? DEFAULT_MAX_PAGES,
    });

    const requested = input.pages;
    const scope = requested
      ? siteMap.filter(
          (e) => requested.includes(e.path) && e.status === "captured",
        )
      : siteMap.filter((e) => e.status === "captured");

    // ---- per-page capture ----
    const pages: ExtractArtifact["pages"] = [];
    let cssGlobal: ExtractArtifact["css"] | null = null;
    const axeResults: ExtractArtifact["sourceBaseline"]["axe"] = [];
    const networkResults: ExtractArtifact["sourceBaseline"]["network"] = [];
    let screenshotCount = 0;

    const uploadPrefix = `workspaces/${input.workspaceUuid}/sites/${input.siteUuid}/pipeline/extract`;
    const upload = async (filename: string, body: Buffer) =>
      uploadPipelineImage(
        input.s3,
        input.config,
        `${uploadPrefix}/${filename}`,
        body,
      );

    const failedPaths = new Set<string>();
    for (const entry of scope) {
      try {
        const captured = await capturePage(context, entry.url);

        // CSS: full extraction on first page (site-global), skip on the rest.
        if (!cssGlobal) {
          const cssPage = await context.newPage();
          try {
            await cssPage.goto(entry.url, { waitUntil: "domcontentloaded" });
            cssGlobal = await extractCss(cssPage);
          } finally {
            await cssPage.close();
          }
        }

        // Fresh page at 1440 for interactions + axe (capturePage leaves the
        // viewport at 375).
        const intPage = await context.newPage();
        let interactionsBefore: Awaited<
          ReturnType<typeof captureInteractions>
        > = [];
        let axe: Awaited<ReturnType<typeof runAxeBaseline>> = {
          path: entry.path,
          violations: [],
        };
        try {
          await intPage.setViewportSize({ width: 1440, height: 900 });
          await intPage.goto(entry.url, { waitUntil: "domcontentloaded" });
          await intPage.waitForTimeout(1500);
          interactionsBefore = await captureInteractions(intPage);
          axe = await runAxeBaseline(intPage, entry.path);
        } finally {
          await intPage.close();
        }

        const pageKey =
          entry.path === "/"
            ? "index"
            : entry.path.replace(/^\/+|\/+$/g, "").replace(/[^\w.-]+/g, "-");

        const screenshots = {
          full1440: await upload(`${pageKey}-1440.png`, captured.screenshots.full1440),
          vp768: await upload(`${pageKey}-768.png`, captured.screenshots.vp768),
          vp375: await upload(`${pageKey}-375.png`, captured.screenshots.vp375),
        };
        screenshotCount += 3;

        const interactions: ExtractArtifact["pages"][number]["interactions"] = [];
        for (const raw of interactionsBefore) {
          const beforeUrl = await upload(
            `${pageKey}-${raw.id}-before.png`,
            raw.before,
          );
          const afterUrl = await upload(
            `${pageKey}-${raw.id}-after.png`,
            raw.after,
          );
          interactions.push({
            id: raw.id,
            trigger: raw.trigger,
            selector: raw.selector,
            beforeUrl,
            afterUrl,
            styleDiff: raw.styleDiff,
            boundingBox: raw.boundingBox,
          });
          screenshotCount += 2;
        }

        axeResults.push(axe);
        networkResults.push(
          networkStatsFromCapture(entry.path, captured.networkStats),
        );

        // ExtractPage.content omits rawText — strip it before persisting.
        const {
          rawText: _rawText,
          ...contentForArtifact
        } = captured.content;

        pages.push({
          path: entry.path,
          media: captured.media,
          screenshots,
          content: contentForArtifact,
          interactions,
          responsive: captured.responsive,
          pixelSamples: captured.pixelSamples,
          flags: captured.flags,
        });
      } catch (err) {
        failedPaths.add(entry.path);
        const logger = (input.config as unknown as { logger?: { error: (...args: unknown[]) => void } }).logger;
        if (logger?.error) {
          logger.error({ err, path: entry.path }, "[extract] per-page capture failed");
        } else {
          console.error(`[extract] page ${entry.path} failed:`, err);
        }
      }
    }

    // ---- Lighthouse against the shared debug port ----
    const lighthouse: ExtractArtifact["sourceBaseline"]["lighthouse"] = [];
    const lhPage = context.pages()[0] ?? (await context.newPage());
    const debugPort = await resolveDebugPort(lhPage);
    if (debugPort) {
      for (const entry of scope.slice(0, LIGHTHOUSE_PAGE_CAP)) {
        if (failedPaths.has(entry.path)) continue;
        for (const preset of ["mobile", "desktop"] as const) {
          const lh = await runLighthouse(
            entry.url,
            entry.path,
            preset,
            debugPort,
          );
          if (lh) lighthouse.push(lh);
        }
      }
    }

    // ---- annotate failed captures on the site map ----
    const annotatedSiteMap = siteMap.map((e) =>
      failedPaths.has(e.path)
        ? { ...e, status: "skipped" as const, skipReason: "capture-failed" }
        : e,
    );

    // ---- merge-on-write with any prior extract artifact ----
    const existing = await loadArtifact<ExtractArtifact>(input.db, ctx, "extract");
    const fresh: ExtractArtifact = {
      url: input.url,
      extractedAt: new Date().toISOString(),
      siteMap: annotatedSiteMap,
      css: cssGlobal ?? { tokens: {}, breakpoints: [], animations: [] },
      pages,
      sourceBaseline: {
        capturedAt: new Date().toISOString(),
        lighthouse,
        axe: axeResults,
        network: networkResults,
      },
      usage: { pagesCaptured: pages.length, screenshotCount },
    };
    const merged = mergePages(existing?.payload ?? null, fresh);

    const artifact = ExtractArtifactSchema.parse(merged);
    await saveArtifact(input.db, ctx, "extract", artifact);
    return artifact;
  } finally {
    await context.close().catch(() => {});
    await browser.close();
  }
}

function mergePages(
  existing: ExtractArtifact | null,
  fresh: ExtractArtifact,
): ExtractArtifact {
  if (!existing) return fresh;
  const freshPaths = new Set(fresh.pages.map((p) => p.path));
  const preservedPages = existing.pages.filter((p) => !freshPaths.has(p.path));
  const preservedAxe = existing.sourceBaseline.axe.filter(
    (a) => !freshPaths.has(a.path),
  );
  const preservedNetwork = existing.sourceBaseline.network.filter(
    (n) => !freshPaths.has(n.path),
  );

  // Union preserved sitemap entries — fresh siteMap authoritative on overlap.
  const freshMapPaths = new Set(fresh.siteMap.map((e) => e.path));
  const mergedSiteMap = [
    ...fresh.siteMap,
    ...existing.siteMap.filter((e) => !freshMapPaths.has(e.path)),
  ];

  const mergedPages = [...fresh.pages, ...preservedPages];

  return {
    ...fresh,
    siteMap: mergedSiteMap,
    pages: mergedPages,
    sourceBaseline: {
      ...fresh.sourceBaseline,
      axe: [...fresh.sourceBaseline.axe, ...preservedAxe],
      network: [...fresh.sourceBaseline.network, ...preservedNetwork],
      lighthouse: [
        ...fresh.sourceBaseline.lighthouse,
        ...existing.sourceBaseline.lighthouse.filter(
          (lh) => !freshPaths.has(lh.path),
        ),
      ],
    },
    usage: {
      pagesCaptured: mergedPages.length,
      // Per-run screenshot count; not cumulative across historical runs.
      screenshotCount: fresh.usage.screenshotCount,
    },
  };
}

async function discoverPages(
  context: BrowserContext,
  url: string,
): Promise<DiscoveryInputs> {
  const page = await context.newPage();
  const base = new URL(url);
  let sitemapUrls: string[] = [];
  let navLinks: DiscoveryInputs["navLinks"] = [];
  let footerLinks: DiscoveryInputs["footerLinks"] = [];
  let sweepLinks: string[] = [];
  let title = "";

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000);

    try {
      const res = await context.request.get(`${base.origin}/sitemap.xml`, {
        timeout: 10_000,
      });
      if (res.ok()) {
        const text = await res.text();
        for (const m of text.matchAll(/<loc>([^<]+)<\/loc>/g)) {
          sitemapUrls.push(m[1]!);
        }
      }
    } catch {
      /* no sitemap — fine */
    }

    const links = await page.evaluate(() => {
      const grab = (root: Element | null) =>
        root
          ? Array.from(root.querySelectorAll("a[href]")).map((a) => ({
              label: (a as HTMLElement).innerText.trim(),
              href: a.getAttribute("href") ?? "",
            }))
          : [];
      return {
        navLinks: grab(
          document.querySelector("header") ?? document.querySelector("nav"),
        ),
        footerLinks: grab(document.querySelector("footer")),
        sweepLinks: Array.from(document.querySelectorAll("a[href]")).map(
          (a) => a.getAttribute("href") ?? "",
        ),
        title: document.title,
      };
    });
    navLinks = links.navLinks;
    footerLinks = links.footerLinks;
    sweepLinks = links.sweepLinks;
    title = links.title;
  } finally {
    await page.close();
  }

  return {
    baseUrl: url,
    sitemapUrls,
    navLinks,
    footerLinks,
    sweepLinks,
    pageTitles: { "/": title },
  };
}

/**
 * chromium.launch with `--remote-debugging-port=0` binds a free port. Playwright's
 * public `Browser` API doesn't expose that port directly, so we ask the browser
 * over a CDP session (Browser.getVersion returns webSocketDebuggerUrl) and parse
 * the port out. If anything fails Lighthouse is best-effort and gets skipped.
 */
async function resolveDebugPort(page: Page): Promise<number | null> {
  try {
    const session = await page.context().newCDPSession(page);
    const info = (await session.send("Browser.getVersion")) as {
      webSocketDebuggerUrl?: string;
    };
    await session.detach().catch(() => {});
    if (!info.webSocketDebuggerUrl) return null;
    const port = new URL(info.webSocketDebuggerUrl).port;
    const num = port ? Number(port) : NaN;
    if (!Number.isFinite(num) || num <= 0) {
      console.warn(
        "[extract] resolveDebugPort: could not parse port from",
        info.webSocketDebuggerUrl,
      );
      return null;
    }
    return num;
  } catch (err) {
    console.warn(
      "[extract] resolveDebugPort failed — Lighthouse will be skipped:",
      err,
    );
    return null;
  }
}
