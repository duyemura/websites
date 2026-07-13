import type { Kysely } from "kysely";
import type { DB } from "../types/db";
import type { Config } from "../plugins/env";
import type { ScrapedImage } from "@milo/shared-types";
import { getS3Client, buildS3ObjectUrl } from "../s3";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import path from "node:path";
import crypto from "node:crypto";
import { isHttpUrl, isInternalUrl } from "./http-url";

const MAX_ASSET_SIZE_BYTES = 25 * 1024 * 1024;

async function downloadAsset(url: string): Promise<{ buffer: Buffer; contentType?: string } | null> {
  if (!isHttpUrl(url) || isInternalUrl(url)) return null;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PushPressBot/1.0; +https://www.pushpress.com)",
      },
      signal: AbortSignal.timeout(30000),
      redirect: "follow",
    });
    if (!response.ok) {
      return null;
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_ASSET_SIZE_BYTES) {
      return null;
    }

    const reader = response.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_ASSET_SIZE_BYTES) {
        await reader.cancel("asset exceeds size limit");
        return null;
      }
      chunks.push(value);
    }

    const buffer = Buffer.concat(chunks);
    return {
      buffer,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  } catch {
    return null;
  }
}

export interface ScrapedAssetMap {
  byOriginalUrl: Map<string, { assetUuid: string; url: string; storageKey: string }>;
}

function extensionFromUrl(url: string, contentType?: string): string {
  if (contentType) {
    const ext = mimeExtension(contentType);
    if (ext) return ext;
  }
  try {
    const parsed = new URL(url);
    const basename = path.basename(parsed.pathname) || "asset";
    const ext = path.extname(basename);
    if (ext) return ext;
  } catch {
    // fall through
  }
  return ".bin";
}

function mimeExtension(contentType: string): string | null {
  const mapping: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "font/woff2": ".woff2",
    "font/woff": ".woff",
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "application/pdf": ".pdf",
  };
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return mapping[normalized] ?? null;
}

function assetTypeFromMime(contentType?: string): "image" | "font" | "document" {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("font/") || normalized.endsWith("/font")) return "font";
  if (normalized.startsWith("image/")) return "image";
  return "document";
}

function assetTypeFromUrl(url: string): "image" | "font" | "document" {
  const ext = extensionFromUrl(url).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif", ".bmp", ".ico"].includes(ext)) {
    return "image";
  }
  if ([".woff2", ".woff", ".ttf", ".otf", ".eot"].includes(ext)) {
    return "font";
  }
  return "document";
}


export async function downloadScrapedAssets(
  db: Kysely<DB>,
  config: Config,
  workspaceUuid: string,
  siteUuid: string,
  images: ScrapedImage[],
): Promise<ScrapedAssetMap> {
  const s3 = getS3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
  });

  const byOriginalUrl = new Map<string, { assetUuid: string; url: string; storageKey: string }>();
  const seenUrls = new Set<string>();

  for (const image of images) {
    const originalUrl = image.url;
    if (!originalUrl || seenUrls.has(originalUrl)) continue;
    seenUrls.add(originalUrl);

    const existing = await db
      .selectFrom("assets")
      .select(["uuid", "url", "storageKey"])
      .where("workspaceUuid", "=", workspaceUuid)
      .where("source", "=", "scraped")
      .where("metadata", "@>", JSON.stringify({ originalUrl }))
      // Scope asset reuse to the current site so generated pages never reference
      // an old site's S3 prefix. Re-scraping the same site still reuses; a new
      // site always gets its own copy under its own prefix.
      .where("storageKey", "like", `workspaces/${workspaceUuid}/sites/${siteUuid}/%`)
      .executeTakeFirst();

    if (existing) {
      // Reconstruct the URL from storageKey so old assets with malformed URLs
      // (e.g. bucket duplicated in the path) still produce a working public URL.
      const publicUrl = buildS3ObjectUrl({
        endpoint: config.S3_ENDPOINT,
        region: config.S3_REGION,
        bucket: config.S3_ASSETS_BUCKET,
        key: existing.storageKey,
      });

      // If the stored URL does not match the current storage config (e.g. the
      // bucket or endpoint changed), or the S3 object no longer exists, fall
      // through and re-upload the asset under the new site so previews don't
      // reference broken/missing objects.
      let objectExists = false;
      if (publicUrl === existing.url) {
        try {
          await s3.send(
            new HeadObjectCommand({
              Bucket: config.S3_ASSETS_BUCKET,
              Key: existing.storageKey,
            }),
          );
          objectExists = true;
        } catch {
          objectExists = false;
        }
      }

      if (objectExists) {
        byOriginalUrl.set(originalUrl, {
          assetUuid: existing.uuid,
          url: publicUrl,
          storageKey: existing.storageKey,
        });
        continue;
      }
      // Otherwise fall through to re-download and upload to current storage.
    }

    const downloaded = await downloadAsset(originalUrl);
    if (!downloaded) continue;

    const contentType = downloaded.contentType;
    const type = contentType ? assetTypeFromMime(contentType) : assetTypeFromUrl(originalUrl);
    const ext = extensionFromUrl(originalUrl, contentType);
    const hash = crypto.createHash("sha256").update(originalUrl).digest("hex").slice(0, 16);
    const filename = path.posix.basename(new URL(originalUrl).pathname) || `asset${ext}`;
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_");

    const storageKey = path.posix.join(
      "workspaces",
      workspaceUuid,
      "sites",
      siteUuid,
      "scraped-assets",
      type,
      `${hash}-${safeFilename}`,
    );

    await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_ASSETS_BUCKET,
        Key: storageKey,
        Body: downloaded.buffer,
        ContentType: contentType ?? "application/octet-stream",
      }),
    );

    const publicUrl = buildS3ObjectUrl({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      bucket: config.S3_ASSETS_BUCKET,
      key: storageKey,
    });

    const asset = await db
      .insertInto("assets")
      .values({
        workspaceUuid,
        name: safeFilename,
        type,
        source: "scraped",
        mimeType: contentType ?? null,
        url: publicUrl,
        storageKey,
        metadata: {
          filename: safeFilename,
          description: `Scraped from ${originalUrl}`,
          tags: ["scraped-asset", image.context],
          originalUrl,
          context: image.context,
          scrapedAt: new Date().toISOString(),
        },
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    byOriginalUrl.set(originalUrl, {
      assetUuid: asset.uuid,
      url: publicUrl,
      storageKey,
    });
  }

  return { byOriginalUrl };
}

