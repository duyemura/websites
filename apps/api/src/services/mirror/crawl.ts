import { chromium, type Page } from "playwright";
import { getS3Client } from "../../s3";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type {
  DynamicRegion,
  MirrorCrawlArtifact,
  MirrorForm,
  MirrorPage,
  MirrorRedirect,
} from "../../types/mirror";

export const MAX_PAGES = 50;

const ASSET_EXT_RE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mov|webm|css|js|ico|woff2?)$/i;

const BOOKING_WIDGET_HOSTS = [
  "mindbodyonline.com",
  "widgets.mindbodyonline.com",
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

async function collectEvidence(page: Page): Promise<PageEvidence> {
  return page.evaluate((bookingHosts: string[]) => {
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
    const bodyText = document.body.innerText.toLowerCase();

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

    // Detect booking widgets — they work on the mirror but may need domain
    // allowlist update during preview phase on *.ploysites.com
    for (const host of embedHosts) {
      const matched = bookingHosts.find((bh) => host === bh || host.endsWith(`.${bh}`));
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
  }, BOOKING_WIDGET_HOSTS);
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
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export async function crawlSite(
  sourceUrl: string,
  deps: CrawlDeps,
): Promise<MirrorCrawlArtifact> {
  const origin = new URL(sourceUrl).origin;
  const s3Client = getS3Client(deps.s3);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const queue: string[] = [normalizeCrawlUrl(sourceUrl, origin) ?? sourceUrl];
  const seen = new Set<string>(queue);
  const pages: MirrorPage[] = [];
  const failures: { url: string; reason: string }[] = [];
  const redirects: MirrorRedirect[] = [];

  while (queue.length > 0 && pages.length < MAX_PAGES) {
    const url = queue.shift()!;
    try {
      const response = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
      const finalUrl = page.url();
      const finalPath = new URL(finalUrl).pathname;
      const origPath = new URL(url).pathname;

      if (finalPath !== origPath) {
        redirects.push({
          from: origPath,
          to: finalPath,
          status: response?.status() ?? 301,
        });
      }

      const html = await page.content();
      const evidence = await collectEvidence(page);
      const pagePath = finalPath;

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

  await browser.close();
  return { sourceUrl, origin, pages, redirects, sitemapXml, robotsTxt, failures };
}
