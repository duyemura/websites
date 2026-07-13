import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { extractCssUrls, rewriteCssUrls } from "../../utils/mirror/rewrite-css";
import { extractImageContexts } from "../../utils/mirror/extract-image-contexts";
import type { AssetAppearance, MirrorAsset, MirrorAssetsArtifact, MirrorCrawlArtifact } from "../../types/mirror";
import { tagPhotoAssets, type VisionConfig } from "./tag-assets";

const ASSET_SELECTORS: [string, string][] = [
  ["link[rel=stylesheet][href]", "href"],
  ["link[rel*=icon][href]", "href"],
  ["script[src]", "src"],
  ["img[src]", "src"],
  ["source[src]", "src"],
  ["video[poster]", "poster"],
];

const FETCH_CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 15_000;
// Skip files larger than this — avoids pulling full video files accidentally
const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB

export function collectAssetUrls(html: string, pageUrl: string, _origin: string): string[] {
  const $ = cheerio.load(html);
  const out = new Set<string>();
  const add = (raw: string | undefined) => {
    // Skip data URIs, blob URLs, and empty values — everything else gets rehosted.
    // The gym is leaving their old host; we download and own all static assets
    // regardless of whether they live on the gym's domain or a third-party CDN
    // (Webflow CDN, Squarespace CDN, Google Fonts, etc.).
    if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return;
    try {
      const abs = new URL(raw, pageUrl);
      abs.hash = "";
      out.add(abs.toString());
    } catch { /* unparseable URL — skip */ }
  };
  for (const [selector, attr] of ASSET_SELECTORS) {
    $(selector).each((_, el) => add($(el).attr(attr)));
  }
  $("img[srcset], source[srcset]").each((_, el) => {
    for (const entry of ($(el).attr("srcset") ?? "").split(",")) {
      const url = entry.trim().split(/\s+/)[0];
      if (url) add(url);
    }
  });
  return [...out];
}

export function assetLocalName(url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 12);
  const pathname = new URL(url).pathname;
  const dot = pathname.lastIndexOf(".");
  const ext = dot >= 0 && dot > pathname.lastIndexOf("/") ? pathname.slice(dot) : ".bin";
  return `${hash}${ext}`;
}

/** Run `fn` over `items` with at most `concurrency` in-flight at once. */
async function bounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await fn(item);
    }
  });
  await Promise.all(workers);
}

export interface CaptureDeps {
  s3Client: S3Client;
  bucket: string;
  /** e.g. sites/{siteUuid}/snapshots/{version} */
  snapshotPrefix: string;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
  /** Optional vision config; when provided, photo assets are tagged for contextual matching. */
  vision?: VisionConfig;
}

async function getS3Text(s3: S3Client, bucket: string, key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return (await res.Body?.transformToString()) ?? "";
}

async function fetchBinary(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Guard against accidentally pulling huge video files
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_ASSET_BYTES) {
    throw new Error(`Asset too large (${Math.round(length / 1024 / 1024)}MB > 50MB limit): ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_ASSET_BYTES) {
    throw new Error(`Asset too large after download (${Math.round(buffer.byteLength / 1024 / 1024)}MB): ${url}`);
  }

  return {
    buffer,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}

export async function captureAssets(
  crawl: MirrorCrawlArtifact,
  deps: CaptureDeps,
): Promise<{ artifact: MirrorAssetsArtifact; assetMap: Map<string, string> }> {
  const urls = new Set<string>();
  const appearancesByUrl = new Map<string, AssetAppearance[]>();

  for (const page of crawl.pages) {
    const html = await getS3Text(deps.s3Client, deps.bucket, page.htmlKey);
    for (const u of collectAssetUrls(html, page.url, crawl.origin)) urls.add(u);
    const contexts = extractImageContexts(html, page.url, page.path);
    for (const ctx of contexts) {
      const list = appearancesByUrl.get(ctx.originalUrl) ?? [];
      list.push(ctx);
      appearancesByUrl.set(ctx.originalUrl, list);
    }
  }

  // Download assets with bounded concurrency — sequential was 5-10min on real sites (I3)
  const downloads = new Map<string, { buffer: Buffer; contentType: string }>();
  const failures: { url: string; reason: string }[] = [];

  let pending = [...urls];
  let cssDepth = 0;
  while (pending.length > 0 && cssDepth <= 2) {
    const nested = new Set<string>();
    await bounded(pending, FETCH_CONCURRENCY, async (url) => {
      if (downloads.has(url)) return;
      try {
        const dl = await fetchBinary(url);
        downloads.set(url, dl);
        if (dl.contentType.includes("text/css") || url.endsWith(".css")) {
          for (const ref of extractCssUrls(dl.buffer.toString("utf8"), url)) {
            // Follow CSS refs from any origin — e.g. Webflow CDN CSS imports fonts from Google
            if (!ref.startsWith("data:") && !downloads.has(ref)) nested.add(ref);
          }
        }
      } catch (err) {
        failures.push({ url, reason: err instanceof Error ? err.message : String(err) });
      }
    });
    pending = [...nested];
    cssDepth += 1;
  }

  // Vision-tag photo assets so later stages can match images to section context.
  const visionTags = await tagPhotoAssets(
    [...downloads.entries()].map(([url, dl]) => ({ url, buffer: dl.buffer, contentType: dl.contentType })),
    deps.vision,
    deps.log,
  );

  // Build the complete map before uploading so CSS can be rewritten against it
  const assetMap = new Map<string, string>();
  for (const url of downloads.keys()) assetMap.set(url, `/_assets/${assetLocalName(url)}`);

  const assets: MirrorAsset[] = [];
  const uploadEntries = [...downloads.entries()];
  await bounded(uploadEntries, FETCH_CONCURRENCY, async ([url, dl]) => {
    const localName = assetLocalName(url);
    const storageKey = `${deps.snapshotPrefix}/assets/${localName}`;
    let body = dl.buffer;
    if (dl.contentType.includes("text/css") || url.endsWith(".css")) {
      body = Buffer.from(rewriteCssUrls(body.toString("utf8"), url, assetMap), "utf8");
    }
    await deps.s3Client.send(
      new PutObjectCommand({
        Bucket: deps.bucket,
        Key: storageKey,
        Body: body,
        ContentType: dl.contentType,
      }),
    );

    const tags = visionTags.get(url);
    const appearances = appearancesByUrl.get(url);

    assets.push({
      originalUrl: url,
      storageKey,
      localPath: `/_assets/${localName}`,
      contentType: dl.contentType,
      appearances: appearances && appearances.length > 0 ? appearances : undefined,
      visionTags: tags?.tags,
      visionDescription: tags?.description,
      visionContexts: tags?.contexts,
      visionSubject: tags?.subject,
      visionConfidence: tags?.confidence,
    });
  });

  deps.log.info({ count: assets.length, failures: failures.length, tagged: visionTags.size }, "mirror assets captured");
  return { artifact: { assets, failures }, assetMap };
}
