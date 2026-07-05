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
const CRAWL_CONCURRENCY = 5;

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

/**
 * UGC path prefixes: individual posts/recipes/articles discovered in the registry
 * but not rendered on the free tier. The INDEX page (/blog, /recipes) is structural.
 *
 * Pattern: /ugc-parent/anything-deeper → UGC
 * e.g. /blog/my-post → UGC, /blog → structural
 */
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

const LOC_RE = /<loc>\s*([^<]+)\s*<\/loc>/gi;
const SITEMAP_RE = /<sitemap>/i;

/** Extract all <loc> URLs from a sitemap or sitemap index XML string. */
function extractSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    const loc = m[1]?.trim();
    if (loc) out.push(loc);
  }
  return out;
}

/**
 * Fetch sitemap from the origin, handling sitemap index files (1 level deep).
 * Returns an array of page URLs already normalized to the origin, or [] if none found.
 */
async function fetchSitemapUrls(
  origin: string,
  context: BrowserContext,
): Promise<string[]> {
  const tryFetch = async (url: string): Promise<string | null> => {
    try {
      const res = await context.request.get(url, { timeout: 10_000 });
      return res.ok() ? await res.text() : null;
    } catch {
      return null;
    }
  };

  // Check robots.txt for a Sitemap: declaration first
  let sitemapUrl = `${origin}/sitemap.xml`;
  const robotsTxt = await tryFetch(`${origin}/robots.txt`);
  if (robotsTxt) {
    const match = /^Sitemap:\s*(.+)$/im.exec(robotsTxt);
    if (match?.[1]) sitemapUrl = match[1].trim();
  }

  const xml = await tryFetch(sitemapUrl);
  if (!xml) return [];

  // Sitemap index — fetch each sub-sitemap (1 level only)
  if (SITEMAP_RE.test(xml)) {
    const subUrls = extractSitemapLocs(xml).filter(u => u.endsWith(".xml"));
    const subPages: string[] = [];
    for (const sub of subUrls.slice(0, 10)) { // cap sub-sitemaps
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
    const embedHosts = Array.from(
      document.querySelectorAll("script[src], iframe[src]"),
    )
      .map((el) => {
        try {
          return new URL(el.getAttribute("src") ?? "", location.href).host;
        } catch {
          return "";
        }
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
      dynamicRegions.push({
        kind: "blog",
        selector: "article",
        evidence: `${datedPosts.length} dated entries`,
      });
    }

    const generator = document.querySelector('meta[name="generator"]');
    if (generator?.getAttribute("content")) {
      dynamicRegions.push({
        kind: "plugin",
        selector: 'meta[name="generator"]',
        evidence: generator.getAttribute("content") ?? "",
      });
    }

    for (const host of embedHosts) {
      const matched = hosts.find((bh) => host === bh || host.endsWith(`.${bh}`));
      if (matched) {
        dynamicRegions.push({
          kind: "booking-widget",
          selector: `script[src*="${matched}"], iframe[src*="${matched}"]`,
          evidence: `booking widget from ${host} — verify loads on preview domain`,
        });
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
  /** Tier controls page cap and UGC skip behaviour. Defaults to free tier. */
  tier?: CrawlTier;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export async function crawlSite(
  sourceUrl: string,
  deps: CrawlDeps,
): Promise<MirrorCrawlArtifact> {
  const tier = deps.tier ?? CRAWL_TIER_FREE;
  let origin = new URL(sourceUrl).origin;
  const s3Client = getS3Client(deps.s3);

  const browser = await chromium.launch();
  try {
    // Use a single shared context for sitemap + robots fetch, separate contexts for crawling
    const sharedCtx = await browser.newContext();

    // ---- Shared mutable state (safe: Node.js single-threaded event loop) ----
    const queue: string[] = [];
    const seen = new Set<string>();
    const pages: MirrorPage[] = [];
    const failures: { url: string; reason: string }[] = [];
    const redirects: MirrorRedirect[] = [];
    const ugcRegistry: string[] = [];

    const enqueue = (url: string) => {
      if (!seen.has(url)) {
        seen.add(url);
        queue.push(url);
      }
    };

    // Seed with homepage first
    const startUrl = normalizeCrawlUrl(sourceUrl, origin) ?? sourceUrl;
    enqueue(startUrl);

    // Pre-seed from sitemap — fills the queue before workers start so all
    // CRAWL_CONCURRENCY workers can begin immediately
    const sitemapPageUrls = await fetchSitemapUrls(origin, sharedCtx);
    let seededFromSitemap = 0;
    for (const raw of sitemapPageUrls) {
      const normalized = normalizeCrawlUrl(raw, origin);
      if (normalized) { enqueue(normalized); seededFromSitemap++; }
    }
    deps.log.info(
      { queueSize: queue.length, fromSitemap: seededFromSitemap },
      seededFromSitemap > 0
        ? "mirror crawl: queue seeded from sitemap + homepage"
        : "mirror crawl: no sitemap found — BFS fallback",
    );

    // ---- Worker: crawls one page, adds discovered links to shared queue ----
    const crawlPage = async (url: string, ctx: BrowserContext): Promise<void> => {
      if (pages.length >= tier.maxCapturedPages) return;

      const page = await ctx.newPage();
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

        const status = response?.status() ?? 0;
        if (status >= 400) {
          failures.push({ url, reason: `HTTP ${status}` });
          return;
        }

        const finalUrl = page.url();
        const finalPath = new URL(finalUrl).pathname;
        const origPath = new URL(url).pathname;

        // Update origin after first successful nav (handles http→https, bare→www)
        if (pages.length === 0 && redirects.length === 0) {
          origin = new URL(finalUrl).origin;
        }

        // Deduplicate redirect targets
        const normalizedFinal = normalizeCrawlUrl(finalUrl, origin);
        if (normalizedFinal && seen.has(normalizedFinal) && normalizedFinal !== url) return;
        if (normalizedFinal) seen.add(normalizedFinal);

        if (finalPath !== origPath) {
          redirects.push({ from: origPath, to: finalPath, status: response?.status() ?? 301 });
        }

        const pagePath = finalPath;
        const pageCategory = classifyPath(pagePath);

        // Collect evidence regardless — we always want to discover links
        const evidence = await collectEvidence(page, BOOKING_WIDGET_HOSTS);

        // Add discovered links to shared queue
        for (const link of evidence.links) {
          const normalized = normalizeCrawlUrl(link, origin, finalUrl);
          if (normalized) enqueue(normalized);
        }

        // Free tier: register UGC but don't capture it
        if (tier.skipUgcCapture && pageCategory === "ugc") {
          ugcRegistry.push(pagePath);
          deps.log.info({ url, category: "ugc" }, "mirror crawl: UGC discovered, not captured (free tier)");
          return;
        }

        // Check cap again after link discovery (another worker may have hit it)
        if (pages.length >= tier.maxCapturedPages) return;

        const html = await page.content();
        const htmlKey = `sites/${deps.siteUuid}/crawl/${deps.crawlVersion}/${pathToSlug(pagePath)}.html`;
        await s3Client.send(
          new PutObjectCommand({
            Bucket: deps.s3.bucket,
            Key: htmlKey,
            Body: Buffer.from(html, "utf8"),
            ContentType: "text/html; charset=utf-8",
          }),
        );

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

    // ---- Parallel workers drain the shared queue ----
    // Each worker pulls from the front of the queue. When empty it checks whether
    // any other workers might still be adding URLs (activeWorkers > 1) and yields
    // briefly, then exits if queue is still empty.
    let activeWorkers = 0;

    const runWorker = async () => {
      activeWorkers++;
      const ctx = await browser.newContext();
      try {
        while (pages.length < tier.maxCapturedPages) {
          const url = queue.shift();
          if (!url) {
            if (activeWorkers === 1) break; // Last worker, nothing left
            // Other workers may still be mid-page and about to enqueue links
            await new Promise((r) => setTimeout(r, 100));
            if (queue.length === 0) break;
            continue;
          }
          await crawlPage(url, ctx);
        }
      } finally {
        activeWorkers--;
        await ctx.close();
      }
    };

    const workerCount = Math.min(CRAWL_CONCURRENCY, Math.max(1, queue.length));
    await Promise.all(Array.from({ length: workerCount }, runWorker));

    // Fetch sitemap + robots for the artifact (separate from the URL seeding above)
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
