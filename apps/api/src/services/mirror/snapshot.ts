import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";

async function bounded<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    let item: T | undefined;
    while ((item = queue.shift()) !== undefined) await fn(item);
  });
  await Promise.all(workers);
}
import { rewriteHtml } from "../../utils/mirror/rewrite-html";
import type {
  MirrorAssetsArtifact,
  MirrorCrawlArtifact,
  MirrorSnapshotArtifact,
} from "../../types/mirror";

export function pathToFileKey(pagePath: string): string {
  // Strip query string and fragment before computing the file key (C1)
  const clean = (pagePath.split("?")[0] ?? pagePath).split("#")[0] ?? pagePath;
  const trimmed = clean.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "index.html";
  if (/\.[a-z0-9]+$/i.test(trimmed)) return trimmed;
  return `${trimmed}/index.html`;
}

/** Stable outline key for any page path — always distinct from the HTML key. */
export function pathToOutlineKey(pagePath: string): string {
  const clean = (pagePath.split("?")[0] ?? pagePath).split("#")[0] ?? pagePath;
  const trimmed = clean.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "outline.txt";
  // Strip any file extension so /about.html → about/outline.txt (same as /about)
  const base = trimmed.replace(/\.[a-z0-9]+$/i, "");
  return `${base}/outline.txt`;
}

export interface SnapshotDeps {
  s3Client: S3Client;
  bucket: string;
  siteUuid: string;
  snapshotVersion: number;
  log: { info: (o: object, m: string) => void };
}

export async function buildSnapshot(
  crawl: MirrorCrawlArtifact,
  assetsArtifact: MirrorAssetsArtifact,
  deps: SnapshotDeps,
): Promise<MirrorSnapshotArtifact> {
  const snapshotPrefix = `sites/${deps.siteUuid}/snapshots/${deps.snapshotVersion}`;
  const assetMap = new Map(assetsArtifact.assets.map((a) => [a.originalUrl, a.localPath]));
  const knownPaths = new Set(crawl.pages.map((p) => p.path));
  const warnings: string[] = [];
  const pages: { path: string; htmlKey: string }[] = [];

  await bounded(crawl.pages, 12, async (page) => {
    let html: string;
    try {
      const raw = await deps.s3Client.send(
        new GetObjectCommand({ Bucket: deps.bucket, Key: page.htmlKey }),
      );
      html = (await raw.Body?.transformToString()) ?? "";
    } catch (err) {
      warnings.push(`snapshot read failed: ${page.path} (${err instanceof Error ? err.message : String(err)})`);
      return;
    }

    const rewritten = rewriteHtml(html, {
      pageUrl: page.url,
      origin: crawl.origin,
      assetMap,
      forms: page.forms.map((f) => ({ formId: f.formId, selector: f.selector })),
      formEndpointBase: `/forms/${deps.siteUuid}`,
      noindex: false,
      knownPaths,
    });

    const fileKey = pathToFileKey(page.path);
    const htmlKey = `${snapshotPrefix}/pages/${fileKey}`;

    try {
      await deps.s3Client.send(
        new PutObjectCommand({
          Bucket: deps.bucket,
          Key: htmlKey,
          Body: Buffer.from(rewritten, "utf8"),
          ContentType: "text/html; charset=utf-8",
        }),
      );
    } catch (err) {
      warnings.push(`snapshot write failed: ${page.path} (${err instanceof Error ? err.message : String(err)})`);
      return;
    }

    pages.push({ path: page.path, htmlKey });

    for (const region of page.dynamicRegions) {
      const label = region.kind === "booking-widget"
        ? `booking-widget on ${page.path}: ${region.evidence}`
        : `${page.path}: dynamic ${region.kind} (${region.evidence})`;
      warnings.push(label);
    }
  });

  for (const failure of crawl.failures) {
    warnings.push(`crawl failed: ${failure.url} (${failure.reason})`);
  }
  for (const failure of assetsArtifact.failures) {
    warnings.push(`asset failed: ${failure.url} (${failure.reason})`);
  }

  deps.log.info({ pages: pages.length, warnings: warnings.length }, "mirror snapshot built");
  return {
    s3Prefix: snapshotPrefix,
    pages,
    redirects: crawl.redirects,
    assetCount: assetsArtifact.assets.length,
    warnings,
  };
}
