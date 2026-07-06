import type { Kysely } from "kysely";
import type { DB, Json } from "../types/db";
import type { Config } from "../plugins/env";
import { chromium, type Browser } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, getSignedDownloadUrl } from "../s3";

async function signScreenshotUrl(
  config: Config,
  storageKey: string,
): Promise<string> {
  return getSignedDownloadUrl({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY,
    secretAccessKey: config.S3_SECRET_KEY,
    sessionToken: config.S3_SESSION_TOKEN,
    bucket: config.S3_ASSETS_BUCKET,
    key: storageKey,
    expiresIn: 3600,
  });
}

export async function resolveReferenceScreenshot(
  db: Kysely<DB>,
  config: Config,
  workspaceUuid: string,
  siteUuid: string,
  sourceUrl: string,
  pageSlug: string,
): Promise<{ assetUuid: string; url: string } | null> {
  const existing = await db
    .selectFrom("assets")
    .select(["uuid", "url", "storageKey"])
    .where("workspaceUuid", "=", workspaceUuid)
    .where("type", "=", "image")
    .$call((q) =>
      q.where("metadata", "@>", {
        siteUuid,
        tags: ["reference-screenshot", pageSlug],
      } as Json),
    )
    .orderBy("createdAt", "desc")
    .executeTakeFirst();

  if (existing) {
    // Reconstruct a fresh signed URL from storageKey so private S3 objects
    // can be downloaded by the QA pipeline.
    const signedUrl = await signScreenshotUrl(config, existing.storageKey);
    return { assetUuid: existing.uuid, url: signedUrl };
  }

  const baseUrl = sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")
    ? sourceUrl
    : `https://${sourceUrl}`;
  const targetUrl = pageSlug === "index" ? baseUrl : new URL(pageSlug, baseUrl).toString();

  let browser: Browser | undefined;
  let tmpPath: string | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const tmpDir = path.join(os.tmpdir(), "ploy-gyms-screenshots");
    await mkdir(tmpDir, { recursive: true });
    tmpPath = path.join(tmpDir, `ref-${siteUuid}-${pageSlug}-${Date.now()}.png`);
    await page.screenshot({ path: tmpPath, fullPage: true });
    await page.close();

    const buffer = await readFile(tmpPath);
    const s3 = getS3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY,
      secretAccessKey: config.S3_SECRET_KEY,
    });

    const storageKey = path.posix.join(
      "workspaces",
      workspaceUuid,
      "sites",
      siteUuid,
      "reference-screenshots",
      `${pageSlug}-${Date.now()}.png`,
    );
    const bucket = config.S3_ASSETS_BUCKET;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: buffer,
        ContentType: "image/png",
      }),
    );

    const signedUrl = await signScreenshotUrl(config, storageKey);

    const asset = await db
      .insertInto("assets")
      .values({
        workspaceUuid,
        name: `Reference screenshot: ${pageSlug}`,
        type: "image",
        source: "screenshot",
        mimeType: "image/png",
        url: signedUrl,
        storageKey,
        metadata: {
          filename: `${pageSlug}.png`,
          description: `Reference screenshot of ${targetUrl}`,
          tags: ["reference-screenshot", pageSlug],
          siteUuid,
        },
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { assetUuid: asset.uuid, url: signedUrl };
  } catch (err) {
    console.error("Failed to capture reference screenshot", { siteUuid, pageSlug, err });
    return null;
  } finally {
    await browser?.close();
  }
}
