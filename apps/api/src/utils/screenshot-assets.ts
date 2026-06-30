import type { Kysely } from "kysely";
import type { DB, Json } from "../types/db";
import type { Config } from "../plugins/env";
import { chromium, type Browser } from "playwright";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client } from "../s3";

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
    .select(["uuid", "url"])
    .where("workspaceUuid", "=", workspaceUuid)
    .where("type", "=", "image")
    .$call((q) =>
      q.where("metadata", "@>", {
        tags: ["reference-screenshot", pageSlug],
      } as Json),
    )
    .orderBy("createdAt", "desc")
    .executeTakeFirst();

  if (existing) {
    return { assetUuid: existing.uuid, url: existing.url };
  }

  const targetUrl = pageSlug === "index" ? sourceUrl : new URL(pageSlug, sourceUrl).toString();

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

    const baseUrl = config.CDN_BASE_URL.replace(/\/$/, "");
    const publicUrl = `${baseUrl}/${bucket}/${storageKey}`;

    const asset = await db
      .insertInto("assets")
      .values({
        workspaceUuid,
        name: `Reference screenshot: ${pageSlug}`,
        type: "image",
        source: "screenshot",
        mimeType: "image/png",
        url: publicUrl,
        storageKey,
        metadata: {
          filename: `${pageSlug}.png`,
          description: `Reference screenshot of ${targetUrl}`,
          tags: ["reference-screenshot", pageSlug],
        },
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { assetUuid: asset.uuid, url: asset.url };
  } catch (err) {
    console.error("Failed to capture reference screenshot", { siteUuid, pageSlug, err });
    return null;
  } finally {
    await browser?.close();
  }
}
