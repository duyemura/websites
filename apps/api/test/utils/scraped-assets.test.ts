import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadScrapedAssets } from "../../src/utils/scraped-assets";
import type { Config } from "../../src/plugins/env";
import type { ScrapedImage } from "@milo/shared-types";
import type { Kysely } from "kysely";
import type { DB } from "../../src/types/db";
import { db } from "../../src/database";

const mockConfig = {
  S3_ENDPOINT: "http://localhost:9010",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "minioadmin",
  S3_SECRET_KEY: "minioadmin",
  S3_ASSETS_BUCKET: "milo-test-assets",
  CDN_BASE_URL: "http://localhost:9010",
} as unknown as Config;

function mockFetch(responses: Record<string, { buffer: Buffer; contentType: string; contentLength?: string }>) {
  return vi.fn().mockImplementation((url: string) => {
    const response = responses[url];
    if (!response) {
      return Promise.resolve({ ok: false, status: 404, headers: new Headers(), body: null });
    }
    const chunks = [response.buffer];
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({
        "content-type": response.contentType,
        ...(response.contentLength ? { "content-length": response.contentLength } : {}),
      }),
      body: {
        getReader: () => {
          let done = false;
          return {
            read: () => {
              if (done) return Promise.resolve({ done: true, value: undefined });
              done = true;
              return Promise.resolve({ done: false, value: chunks[0] });
            },
            cancel: () => Promise.resolve(),
          };
        },
      },
    });
  });
}

describe("downloadScrapedAssets", () => {
  let workspaceUuid: string;

  beforeEach(async () => {
    workspaceUuid = crypto.randomUUID();
    await db
      .insertInto("workspaces")
      .values({
        uuid: workspaceUuid,
        slug: `test-ws-${workspaceUuid.slice(0, 8)}`,
        name: "Test workspace",
      })
      .execute();
  });

  afterEach(async () => {
    await db.deleteFrom("assets").where("workspaceUuid", "=", workspaceUuid).execute();
    await db.deleteFrom("workspaces").where("uuid", "=", workspaceUuid).execute();
  });

  test("downloads images and creates scraped asset records", async () => {
    const originalUrl = "https://example.com/hero.png";
    globalThis.fetch = mockFetch({
      [originalUrl]: { buffer: Buffer.from("png-data"), contentType: "image/png" },
    });

    const siteUuid = crypto.randomUUID();
    const images: ScrapedImage[] = [
      { url: originalUrl, context: "hero", alt: "Hero image" },
    ];

    const map = await downloadScrapedAssets(db as Kysely<DB>, mockConfig, workspaceUuid, siteUuid, images);

    expect(map.byOriginalUrl.size).toBe(1);
    const local = map.byOriginalUrl.get(originalUrl);
    expect(local).toBeDefined();
    expect(local!.url).toContain("scraped-assets/image/");
    expect(local!.storageKey).toContain("workspaces/" + workspaceUuid);

    const rows = await db
      .selectFrom("assets")
      .selectAll()
      .where("workspaceUuid", "=", workspaceUuid)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe("scraped");
    expect(rows[0].type).toBe("image");
    expect(rows[0].metadata).toMatchObject({
      originalUrl,
      context: "hero",
    });

    vi.restoreAllMocks();
  });

  test("reuses existing scraped assets for the same original URL", async () => {
    const originalUrl = "https://example.com/logo.png";
    globalThis.fetch = mockFetch({
      [originalUrl]: { buffer: Buffer.from("png-data"), contentType: "image/png" },
    });

    const siteUuid = crypto.randomUUID();
    const images: ScrapedImage[] = [{ url: originalUrl, context: "logo" }];

    const first = await downloadScrapedAssets(db as Kysely<DB>, mockConfig, workspaceUuid, siteUuid, images);
    const second = await downloadScrapedAssets(db as Kysely<DB>, mockConfig, workspaceUuid, siteUuid, images);

    expect(first.byOriginalUrl.get(originalUrl)!.assetUuid).toBe(
      second.byOriginalUrl.get(originalUrl)!.assetUuid,
    );

    const rows = await db
      .selectFrom("assets")
      .selectAll()
      .where("workspaceUuid", "=", workspaceUuid)
      .execute();
    expect(rows).toHaveLength(1);

    vi.restoreAllMocks();
  });

  test("skips assets that fail to download", async () => {
    globalThis.fetch = mockFetch({});

    const siteUuid = crypto.randomUUID();
    const images: ScrapedImage[] = [{ url: "https://example.com/missing.jpg", context: "other" }];

    const map = await downloadScrapedAssets(db as Kysely<DB>, mockConfig, workspaceUuid, siteUuid, images);

    expect(map.byOriginalUrl.size).toBe(0);
    vi.restoreAllMocks();
  });

  test("skips internal URLs to avoid SSRF", async () => {
    globalThis.fetch = mockFetch({});

    const siteUuid = crypto.randomUUID();
    const images: ScrapedImage[] = [{ url: "http://localhost:8080/private.png", context: "other" }];

    const map = await downloadScrapedAssets(db as Kysely<DB>, mockConfig, workspaceUuid, siteUuid, images);

    expect(map.byOriginalUrl.size).toBe(0);
    vi.restoreAllMocks();
  });

  test("skips assets exceeding size limit", async () => {
    const originalUrl = "https://example.com/huge.png";
    globalThis.fetch = mockFetch({
      [originalUrl]: {
        buffer: Buffer.from("x"),
        contentType: "image/png",
        contentLength: String(50 * 1024 * 1024),
      },
    });

    const siteUuid = crypto.randomUUID();
    const images: ScrapedImage[] = [{ url: originalUrl, context: "other" }];

    const map = await downloadScrapedAssets(db as Kysely<DB>, mockConfig, workspaceUuid, siteUuid, images);

    expect(map.byOriginalUrl.size).toBe(0);
    vi.restoreAllMocks();
  });
});
