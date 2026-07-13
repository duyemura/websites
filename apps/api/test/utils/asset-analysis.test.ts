import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import type { Kysely } from "kysely";
import type { DB } from "../../src/types/db";
import { db, config } from "../../src/database";
import { analyzeAsset } from "../../src/utils/asset-analysis";
import { getS3Client } from "../../src/s3";

vi.mock("../../src/ai/llm-with-logging", () => ({
  callLlmAndLog: vi.fn(),
}));

import { callLlmAndLog } from "../../src/ai/llm-with-logging";

const mockConfig = config;

async function uploadTestImage(storageKey: string): Promise<Buffer> {
  const s3 = getS3Client({
    endpoint: mockConfig.S3_ENDPOINT,
    region: mockConfig.S3_REGION,
    accessKeyId: mockConfig.S3_ACCESS_KEY,
    secretAccessKey: mockConfig.S3_SECRET_KEY,
    sessionToken: mockConfig.S3_SESSION_TOKEN,
  });

  const buffer = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .jpeg()
    .toBuffer();

  await s3.send(
    new (await import("@aws-sdk/client-s3")).PutObjectCommand({
      Bucket: mockConfig.S3_ASSETS_BUCKET,
      Key: storageKey,
      Body: buffer,
      ContentType: "image/jpeg",
    }),
  );

  return buffer;
}

function mockLlmSuccess() {
  vi.mocked(callLlmAndLog).mockResolvedValue({
    response: {
      content: JSON.stringify({
        description: "A bright gym interior.",
        altText: "Bright gym interior with equipment.",
        context: "hero",
        confidence: 0.9,
        tags: ["gym", "interior", "bright"],
        technical: { hasText: false, textConfidence: 0.1, faces: 0, people: 0 },
        quality: { score: 4, resolution: "medium", sharpness: "good", issues: [] },
        marketing: {
          mood: "energetic",
          useCases: ["hero"],
          subject: "gym interior",
          brandFit: 0.85,
        },
        safety: { hasIdentifiablePeople: false, needsReview: false },
      }),
      usage: { promptTokens: 100, completionTokens: 80, totalTokens: 180 },
      latencyMs: 500,
    },
    outcome: "success",
    errorMessage: null,
  });
}

describe("analyzeAsset", () => {
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
    await db.deleteFrom("aiActivity").where("workspaceUuid", "=", workspaceUuid).execute();
    await db.deleteFrom("workspaces").where("uuid", "=", workspaceUuid).execute();
    vi.restoreAllMocks();
  });

  test("extracts metadata and stores LLM analysis", async () => {
    const assetUuid = crypto.randomUUID();
    const storageKey = `workspaces/${workspaceUuid}/assets/test.jpg`;
    await uploadTestImage(storageKey);
    mockLlmSuccess();

    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "test.jpg",
        type: "image",
        source: "upload",
        mimeType: "image/jpeg",
        url: "https://s3.test/test.jpg",
        storageKey,
        metadata: { filename: "test.jpg" },
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    const row = await db
      .selectFrom("assets")
      .selectAll()
      .where("uuid", "=", assetUuid)
      .executeTakeFirstOrThrow();

    const metadata = row.metadata as Record<string, unknown>;
    expect(metadata.analysis).toBeDefined();
    expect((metadata.analysis as { altText: string }).altText).toBe(
      "Bright gym interior with equipment.",
    );
    expect((metadata.dimensions as { width: number }).width).toBe(400);
  });

  test("logs AI activity as analyze action", async () => {
    const assetUuid = crypto.randomUUID();
    const storageKey = `workspaces/${workspaceUuid}/assets/test.jpg`;
    await uploadTestImage(storageKey);
    mockLlmSuccess();

    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "test.jpg",
        type: "image",
        source: "upload",
        mimeType: "image/jpeg",
        url: "https://s3.test/test.jpg",
        storageKey,
        metadata: {},
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    expect(callLlmAndLog).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceUuid,
        aiJobUuid: null,
      }),
      expect.objectContaining({
        agent: "asset-curator",
        actionType: "analyze",
        promptTemplateKeys: ["asset-analysis"],
      }),
      mockConfig,
    );
  });

  test("skips screenshot assets", async () => {
    const assetUuid = crypto.randomUUID();
    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "screenshot.png",
        type: "image",
        source: "screenshot",
        mimeType: "image/png",
        url: "https://s3.test/screenshot.png",
        storageKey: `workspaces/${workspaceUuid}/assets/screenshot.png`,
        metadata: {},
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    expect(callLlmAndLog).not.toHaveBeenCalled();
  });

  test("skips non-image assets without fetching from S3", async () => {
    const assetUuid = crypto.randomUUID();
    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "font.woff2",
        type: "font",
        source: "upload",
        mimeType: "font/woff2",
        url: "https://s3.test/font.woff2",
        storageKey: `workspaces/${workspaceUuid}/assets/font.woff2`,
        metadata: {},
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    expect(callLlmAndLog).not.toHaveBeenCalled();
  });

  test("skips assets missing from S3", async () => {
    const assetUuid = crypto.randomUUID();
    mockLlmSuccess();

    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "missing.jpg",
        type: "image",
        source: "upload",
        mimeType: "image/jpeg",
        url: "https://s3.test/missing.jpg",
        storageKey: `workspaces/${workspaceUuid}/assets/missing.jpg`,
        metadata: {},
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    expect(callLlmAndLog).not.toHaveBeenCalled();
    const row = await db
      .selectFrom("assets")
      .selectAll()
      .where("uuid", "=", assetUuid)
      .executeTakeFirstOrThrow();
    expect((row.metadata as Record<string, unknown>).analysis).toBeUndefined();
  });

  test("does not store analysis when LLM fails", async () => {
    const assetUuid = crypto.randomUUID();
    const storageKey = `workspaces/${workspaceUuid}/assets/test.jpg`;
    await uploadTestImage(storageKey);

    vi.mocked(callLlmAndLog).mockResolvedValue({
      response: { content: "" },
      outcome: "failure",
      errorMessage: "vision service unavailable",
    });

    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "test.jpg",
        type: "image",
        source: "upload",
        mimeType: "image/jpeg",
        url: "https://s3.test/test.jpg",
        storageKey,
        metadata: {},
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    const row = await db
      .selectFrom("assets")
      .selectAll()
      .where("uuid", "=", assetUuid)
      .executeTakeFirstOrThrow();
    expect((row.metadata as Record<string, unknown>).analysis).toBeUndefined();
  });

  test("does not store analysis when LLM returns partial outcome", async () => {
    const assetUuid = crypto.randomUUID();
    const storageKey = `workspaces/${workspaceUuid}/assets/test.jpg`;
    await uploadTestImage(storageKey);

    vi.mocked(callLlmAndLog).mockResolvedValue({
      response: { content: "not valid json" },
      outcome: "partial",
      errorMessage: "schema validation failed",
    });

    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "test.jpg",
        type: "image",
        source: "upload",
        mimeType: "image/jpeg",
        url: "https://s3.test/test.jpg",
        storageKey,
        metadata: {},
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    const row = await db
      .selectFrom("assets")
      .selectAll()
      .where("uuid", "=", assetUuid)
      .executeTakeFirstOrThrow();
    expect((row.metadata as Record<string, unknown>).analysis).toBeUndefined();
  });

  test("extracts SVG metadata without invoking sharp", async () => {
    const assetUuid = crypto.randomUUID();
    const storageKey = `workspaces/${workspaceUuid}/assets/logo.svg`;
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>',
    );
    const s3 = getS3Client({
      endpoint: mockConfig.S3_ENDPOINT,
      region: mockConfig.S3_REGION,
      accessKeyId: mockConfig.S3_ACCESS_KEY,
      secretAccessKey: mockConfig.S3_SECRET_KEY,
    });
    await s3.send(
      new (await import("@aws-sdk/client-s3")).PutObjectCommand({
        Bucket: mockConfig.S3_ASSETS_BUCKET,
        Key: storageKey,
        Body: svg,
        ContentType: "image/svg+xml",
      }),
    );

    vi.mocked(callLlmAndLog).mockResolvedValue({
      response: { content: "" },
      outcome: "failure",
      errorMessage: "vision service unavailable",
    });

    await db
      .insertInto("assets")
      .values({
        uuid: assetUuid,
        workspaceUuid,
        name: "logo.svg",
        type: "image",
        source: "upload",
        mimeType: "image/svg+xml",
        url: "https://s3.test/logo.svg",
        storageKey,
        metadata: {},
      })
      .execute();

    await analyzeAsset({
      db: db as Kysely<DB>,
      config: mockConfig,
      workspaceUuid,
      assetUuid,
      userUuid: crypto.randomUUID(),
    });

    const row = await db
      .selectFrom("assets")
      .selectAll()
      .where("uuid", "=", assetUuid)
      .executeTakeFirstOrThrow();
    const metadata = row.metadata as Record<string, unknown>;
    expect((metadata.technicalLocal as { format: string }).format).toBe("svg");
    expect((metadata.dimensions as { width: number }).width).toBe(200);
    expect((metadata.dimensions as { height: number }).height).toBe(100);
  });
});
