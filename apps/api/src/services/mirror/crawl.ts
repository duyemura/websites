import { chromium, type BrowserContext } from "playwright";
import { getS3Client } from "../../s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type {
  CrawlTier,
  DynamicRegion,
  MirrorCrawlArtifact,
  MirrorForm,
  MirrorPage,
  MirrorRedirect,
} from "../../types/mirror";
import { CRAWL_TIER_FREE } from "../../types/mirror";

/** @deprecated Use CRAWL_TIER_FREE.maxCapturedPages or CRAWL_TIER_PAID */
export const MAX_PAGES = 20;

/** Number of concurrent Playwright contexts (pages crawled in parallel). */
const CRAWL_CONCURRENCY = 8;

const ASSET_EXT_RE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mov|webm|css|js|ico|woff2?)$/i;

const BOOKING_WIDGET_HOSTS = [
  "mindbodyonline.com",
  "pike13.com",
  "glofox.com",
  "zenplanner.com",
  "clubready.com",
  "pushpress.com",
  "wodify.com",
  "triib.com",
  "schedulicity.com",
  "acuityscheduling.com",
  "fitreserve.com",
];

const UGC_PARENT_SEGMENTS = new Set([
  "blog", "recipes", "recipe", "articles", "article",
  "news", "posts", "post", "updates", "changelog",
]);

export function classifyPath(path: string): "structural" | "ugc" {
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);
  if (parts.length < 2) return "structural";
  if (UGC_PARENT_SEGMENTS.has(parts[0]!.toLowerCase())) return "ugc";
  return "structural";
}

export function normalizeCrawlUrl(
  href: string,
  origin: string,
  baseUrl?: string,
): string | null {
  let url: URL;
  try {
    url = new URL(href, baseUrl ?? origin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== origin) return null;
  if (ASSET_EXT_RE.test(url.pathname)) return null;
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function pathToSlug(pagePath: string): string {
  if (pagePath === "/") return "index";
  return pagePath.replace(/^\//, "").replace(/\//g, "__");
}

// ---- Sitemap pre-seeding ----

/** Extract all <loc> URLs from a sitemap or sitemap index XML string.
 *  Uses a fresh regex per call — module-scope /g regexes are stateful and unsafe
 *  to reuse across concurrent calls. */
function extractSitemapLocs(xml: string): string[] {
  const re = /<loc>\s*([^<]+)\s*<\/loc>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}

const MAX_SUB_SITEMAPS = 10;

async function fetchSitemapUrls(
  origin: string,
  context: BrowserContext,
  log: { warn: (o: object, m: string) => void },
): Promise<string[]> {
  const tryFetch = async (url: string): Promise<string | null> => {
    try {
      const res = await context.request.get(url, { timeout: 10_000 });
      return res.ok() ? await res.text() : null;
    } catch {
      return null;
    }
  };

  // Check robots.txt for a Sitemap: declaration (I6: validate same-origin)
  let sitemapUrl = `${origin}/sitemap.xml`;
  const robotsTxt = await tryFetch(`${origin}/robots.txt`);
  if (robotsTxt) {
    // Collect ALL Sitemap: declarations (real robots.txt files often list multiple)
    const sitemapMatches = [...robotsTxt.matchAll(/^Sitemap:\s*(.+)$/gim)];
    for (const match of sitemapMatches) {
      const declared = match[1]?.trim();
      if (!declared) continue;
      try {
        const parsed = new URL(declared);
        // Only follow same-origin sitemaps to avoid SSRF-adjacent external fetches
        if (parsed.origin === origin) { sitemapUrl = parsed.toString(); break; }
      } catch { /* ignore malformed */ }
    }
  }

  const xml = await tryFetch(sitemapUrl);
  if (!xml) return [];

  // Sitemap index — fetch sub-sitemaps (1 level deep, capped)
  if (/<sitemapindex/i.test(xml)) {
    const subUrls = extractSitemapLocs(xml);
    if (subUrls.length > MAX_SUB_SITEMAPS) {
      log.warn(
        { total: subUrls.length, using: MAX_SUB_SITEMAPS },
        "mirror crawl: sitemap index truncated — site has many sub-sitemaps",
      );
    }
    const subPages: string[] = [];
    for (const sub of subUrls.slice(0, MAX_SUB_SITEMAPS)) {
      const subXml = await tryFetch(sub);
      if (subXml) subPages.push(...extractSitemapLocs(subXml));
    }
    return subPages;
  }

  return extractSitemapLocs(xml);
}

// ---- Evidence collection ----

interface PageEvidence {
  title: string;
  links: string[];
  forms: { action: string; method: string; selector: string }[];
  dynamicRegions: DynamicRegion[];
  embeds: string[];
}

async function collectEvidence(page: import("playwright").Page, bookingHosts: string[]): Promise<PageEvidence> {
  return page.evaluate((hosts: string[]) => {
    const links = Array.from(document.querySelectorAll("a[href]")).map(
      (a) => (a as HTMLAnchorElement).href,
    );
    const forms = Array.from(document.querySelectorAll("form")).map((f, i) => ({
      action: f.getAttribute("action") ?? "",
      method: (f.getAttribute("method") ?? "get").toLowerCase(),
      selector: `form:nth-of-type(${i + 1})`,
    }));
    const embedHosts = Array.from(document.querySelectorAll("script[src], iframe[src]"))
      .map((el) => {
        try { return new URL(el.getAttribute("src") ?? "", location.href).host; } catch { return ""; }
      })
      .filter((h) => h && h !== location.host);

    const dynamicRegions: DynamicRegion[] = [];
    const bodyText = (document.body?.innerText ?? "").toLowerCase();

    const scheduleWords = ["class schedule", "book a class", "timetable", "wod schedule"];
    for (const w of scheduleWords) {
      if (bodyText.includes(w)) {
        dynamicRegions.push({ kind: "schedule", selector: "body", evidence: `text: "${w}"` });
        break;
      }
    }

    const datedPosts = document.querySelectorAll("article time, .post time, [class*=blog] time");
    if (datedPosts.length >= 2) {
      dynamicRegions.push({ kind: "blog", selector: "article", evidence: `${datedPosts.length} dated entries` });
    }

    const generator = document.querySelector('meta[name="generator"]');
    if (generator?.getAttribute("content")) {
      dynamicRegions.push({ kind: "plugin", selector: 'meta[name="generator"]', evidence: generator.getAttribute("content") ?? "" });
    }

    for (const host of embedHosts) {
      const matched = hosts.find((bh) => host === bh || host.endsWith(`.${bh}`));
      if (matched) {
        dynamicRegions.push({ kind: "booking-widget", selector: `script[src*="${matched}"], iframe[src*="${matched}"]`, evidence: `booking widget from ${host} — verify loads on preview domain` });
        break;
      }
    }

    return { title: document.title, links, forms, dynamicRegions, embeds: embedHosts };
  }, bookingHosts);
}

// ---- Crawl deps / main export ----

export interface CrawlDeps {
  siteUuid: string;
  workspaceUuid: string;
  s3: {
    endpoint?: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
  crawlVersion: number;
  tier?: CrawlTier;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export async function crawlSite(
  sourceUrl: string,
  deps: CrawlDeps,
): Promise<MirrorCrawlArtifact> {
  const tier = deps.tier ?? CRAWL_TIER_FREE;
  const s3Client = getS3Client(deps.s3);

  const browser = await chromium.launch();
  try {
    const sharedCtx = await browser.newContext();

    // ---- Resolve canonical origin ONCE before seeding (I4) ----
    // A redirect (http→https, bare→www) on the first nav changes the origin.
    // Resolve it up front so all workers + sitemap seeding use the same origin.
    let origin = new URL(sourceUrl).origin;
    try {
      const res = await sharedCtx.request.get(sourceUrl, { timeout: 15_000, maxRedirects: 5 });
      const finalUrl = res.url();
      if (finalUrl) origin = new URL(finalUrl).origin;
    } catch { /* unreachable source — proceed with initial origin, first worker will update */ }

    // ---- Shared mutable state (safe: Node.js single-threaded event loop) ----
    const queue: string[] = [];
    const seen = new Set<string>();
    // C2: use a dedicated counter so the cap check is atomic (no await between check and increment)
    let capturedCount = 0;
    const pages: MirrorPage[] = [];
    const failures: { url: string; reason: string }[] = [];
    const redirects: MirrorRedirect[] = [];
    const ugcRegistry: string[] = [];

    const enqueue = (url: string) => {
      if (!seen.has(url)) { seen.add(url); queue.push(url); }
    };

    // Seed: homepage first, then sitemap
    enqueue(normalizeCrawlUrl(sourceUrl, origin) ?? sourceUrl);

    const sitemapPageUrls = await fetchSitemapUrls(origin, sharedCtx, deps.log);
    let seededFromSitemap = 0;
    for (const raw of sitemapPageUrls) {
      const normalized = normalizeCrawlUrl(raw, origin);
      if (normalized) { enqueue(normalized); seededFromSitemap++; }
    }
    deps.log.info(
      { queueSize: queue.length, fromSitemap: seededFromSitemap },
      seededFromSitemap > 0
        ? "mirror crawl: queue seeded from sitemap + homepage"
        : "mirror crawl: no sitemap found — BFS only",
    );

    // ---- Per-page crawl function ----
    const crawlPage = async (url: string, ctx: BrowserContext): Promise<void> => {
      // C2: reserve the slot atomically BEFORE the first await
      if (capturedCount >= tier.maxCapturedPages) return;

      const page = await ctx.newPage();
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

        const status = response?.status() ?? 0;
        if (status >= 400) { failures.push({ url, reason: `HTTP ${status}` }); return; }

        const finalUrl = page.url();
        const finalPath = new URL(finalUrl).pathname;
        const origPath = new URL(url).pathname;

        // Deduplicate redirect targets
        const normalizedFinal = normalizeCrawlUrl(finalUrl, origin);
        if (normalizedFinal && seen.has(normalizedFinal) && normalizedFinal !== url) return;
        if (normalizedFinal) seen.add(normalizedFinal);

        if (finalPath !== origPath) {
          redirects.push({ from: origPath, to: finalPath, status: response?.status() ?? 301 });
        }

        const pagePath = finalPath;
        const pageCategory = classifyPath(pagePath);

        // Always collect evidence to discover links for BFS
        const evidence = await collectEvidence(page, BOOKING_WIDGET_HOSTS);
        for (const link of evidence.links) {
          const normalized = normalizeCrawlUrl(link, origin, finalUrl);
          if (normalized) enqueue(normalized);
        }

        // Free tier: register UGC but skip rendering
        if (tier.skipUgcCapture && pageCategory === "ugc") {
          ugcRegistry.push(pagePath);
          deps.log.info({ url, category: "ugc" }, "mirror crawl: UGC discovered, not captured (free tier)");
          return;
        }

        // C2: check cap again after evidence collection (another worker may have filled it)
        if (capturedCount >= tier.maxCapturedPages) return;
        // Atomically reserve this slot — no await between this and the push below
        capturedCount++;

        const html = await page.content();
        const htmlKey = `sites/${deps.siteUuid}/crawl/${deps.crawlVersion}/${pathToSlug(pagePath)}.html`;
        await s3Client.send(new PutObjectCommand({
          Bucket: deps.s3.bucket,
          Key: htmlKey,
          Body: Buffer.from(html, "utf8"),
          ContentType: "text/html; charset=utf-8",
        }));

        const forms: MirrorForm[] = evidence.forms
          .filter((f) => {
            if (!f.action) return true;
            try { return new URL(f.action, finalUrl).origin === origin; } catch { return false; }
          })
          .map((f, i) => ({
            formId: `${pathToSlug(pagePath)}-f${i + 1}`,
            originalAction: f.action,
            method: f.method,
            selector: f.selector,
          }));

        pages.push({
          url: finalUrl,
          path: pagePath,
          title: evidence.title,
          htmlKey,
          forms,
          dynamicRegions: evidence.dynamicRegions,
          embeds: [...new Set(evidence.embeds)],
          category: pageCategory,
        });

        deps.log.info({ url, pageCount: pages.length, concurrency: CRAWL_CONCURRENCY }, "mirror crawl: page captured");
      } catch (err) {
        failures.push({ url, reason: err instanceof Error ? err.message : String(err) });
        deps.log.warn({ url, err }, "mirror crawl: page failed");
      } finally {
        await page.close();
      }
    };

    // ---- Parallel workers (C1 + C8 fix) ----
    // Always spawn CRAWL_CONCURRENCY workers regardless of initial queue size.
    // Workers with an empty queue yield and retry until no other worker is busy
    // (busyWorkers === 0), ensuring BFS-discovered links are not missed.
    let busyWorkers = 0;

    const runWorker = async () => {
      const ctx = await browser.newContext();
      try {
        while (capturedCount < tier.maxCapturedPages) {
          const url = queue.shift();
          if (!url) {
            // Queue empty: only exit if no other worker is mid-crawl
            // (a busy worker may still enqueue new links)
            if (busyWorkers === 0) break;
            await new Promise((r) => setTimeout(r, 100));
            continue;
          }
          busyWorkers++;
          try { await crawlPage(url, ctx); } finally { busyWorkers--; }
        }
      } finally {
        await ctx.close();
      }
    };

    await Promise.all(Array.from({ length: CRAWL_CONCURRENCY }, runWorker));

    // Fetch sitemap + robots for the artifact record
    let sitemapXml: string | null = null;
    let robotsTxt: string | null = null;
    try {
      const res = await sharedCtx.request.get(`${origin}/sitemap.xml`);
      if (res.ok()) sitemapXml = await res.text();
    } catch { /* absent is fine */ }
    try {
      const res = await sharedCtx.request.get(`${origin}/robots.txt`);
      if (res.ok()) robotsTxt = await res.text();
    } catch { /* absent is fine */ }

    await sharedCtx.close();
    return { sourceUrl, origin, pages, redirects, sitemapXml, robotsTxt, failures, ugcRegistry };
  } finally {
    await browser.close();
  }
}
