import { chromium } from "playwright";
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
  // Normalise: strip leading slash, split
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);
  // Top-level pages and bare collection indexes are always structural
  if (parts.length < 2) return "structural";
  // If the first segment is a UGC parent and there's at least one more segment,
  // the page is a UGC item (individual post/recipe).
  if (UGC_PARENT_SEGMENTS.has(parts[0]!.toLowerCase())) return "ugc";
  return "structural";
}

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
    // Guard against pages with no body (XML, blank, error pages) (I6)
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

    // Booking widgets work on the mirror (we don't rehost third-party scripts) but
    // may need domain allowlist update during preview phase on *.ploysites.com
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
  // origin may be updated after the first navigation if the site redirects
  // http→https or bare→www (I3)
  const tier = deps.tier ?? CRAWL_TIER_FREE;
  let origin = new URL(sourceUrl).origin;
  const s3Client = getS3Client(deps.s3);

  const browser = await chromium.launch();
  // Wrap everything so browser.close() always runs (I5)
  try {
    const context = await browser.newContext();

    const queue: string[] = [normalizeCrawlUrl(sourceUrl, origin) ?? sourceUrl];
    const seen = new Set<string>(queue);
    const pages: MirrorPage[] = [];
    const failures: { url: string; reason: string }[] = [];
    const redirects: MirrorRedirect[] = [];
    // Registry tracks ALL discovered URLs regardless of tier (for redirect map, future paid)
    const ugcRegistry: string[] = [];

    while (queue.length > 0 && pages.length < tier.maxCapturedPages) {
      const url = queue.shift()!;

      // Fresh page per URL — avoids JS heap / listener accumulation across navigations (C2)
      const page = await context.newPage();
      try {
        const response = await page.goto(url, {
          // domcontentloaded prevents networkidle from hanging on booking widget polling (I1)
          waitUntil: "domcontentloaded",
          timeout: 30_000,
        });

        // Short settle for JS-rendered content; ignore timeout (booking widgets will always time out)
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);

        // Skip 4xx/5xx pages — don't capture error templates (I2)
        const status = response?.status() ?? 0;
        if (status >= 400) {
          failures.push({ url, reason: `HTTP ${status}` });
          continue;
        }

        const finalUrl = page.url();
        const finalPath = new URL(finalUrl).pathname;
        const origPath = new URL(url).pathname;

        // After first successful nav, update origin if the site redirected to a different
        // scheme or subdomain (http→https, bare→www) so subsequent link normalization works (I3)
        if (pages.length === 0) {
          origin = new URL(finalUrl).origin;
        }

        // Prevent recrawling the same page reached via a different redirect path (C1)
        const normalizedFinal = normalizeCrawlUrl(finalUrl, origin);
        if (normalizedFinal && seen.has(normalizedFinal) && normalizedFinal !== url) {
          continue;
        }
        if (normalizedFinal) seen.add(normalizedFinal);

        if (finalPath !== origPath) {
          redirects.push({
            from: origPath,
            to: finalPath,
            status: response?.status() ?? 301,
          });
        }

        const pagePath = finalPath;
        const pageCategory = classifyPath(pagePath);

        // Free tier: UGC pages go in the registry (for the redirect map) but are
        // not rendered. We still extract links from them so BFS can discover deeper
        // structural pages that might be linked from a recipe/post.
        if (tier.skipUgcCapture && pageCategory === "ugc") {
          ugcRegistry.push(pagePath);
          // Still extract links for discovery — a recipe might link to a program page
          const evidence = await collectEvidence(page, BOOKING_WIDGET_HOSTS);
          for (const link of evidence.links) {
            const normalized = normalizeCrawlUrl(link, origin, finalUrl);
            if (normalized && !seen.has(normalized)) {
              seen.add(normalized);
              queue.push(normalized);
            }
          }
          deps.log.info({ url, category: "ugc", skipped: true }, "mirror crawl: UGC page discovered but not captured (free tier)");
          continue;
        }

        const html = await page.content();
        const evidence = await collectEvidence(page, BOOKING_WIDGET_HOSTS);

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
            try {
              return new URL(f.action, finalUrl).origin === origin;
            } catch {
              return false;
            }
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

        for (const link of evidence.links) {
          const normalized = normalizeCrawlUrl(link, origin, finalUrl);
          if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            queue.push(normalized);
          }
        }
        deps.log.info({ url, pageCount: pages.length }, "mirror crawl: page captured");
      } catch (err) {
        failures.push({ url, reason: err instanceof Error ? err.message : String(err) });
        deps.log.warn({ url, err }, "mirror crawl: page failed");
      } finally {
        await page.close();
      }
    }

    let sitemapXml: string | null = null;
    let robotsTxt: string | null = null;
    try {
      const res = await context.request.get(`${origin}/sitemap.xml`);
      if (res.ok()) sitemapXml = await res.text();
    } catch { /* absent sitemap is fine */ }
    try {
      const res = await context.request.get(`${origin}/robots.txt`);
      if (res.ok()) robotsTxt = await res.text();
    } catch { /* absent robots is fine */ }

    return { sourceUrl, origin, pages, redirects, sitemapXml, robotsTxt, failures, ugcRegistry };
  } finally {
    await browser.close();
  }
}
