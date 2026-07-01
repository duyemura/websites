import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { build, authHeaders, getTestWorkspaceUuid } from "../helper";
import {
  extractImageMetadata,
  prepareImageForVision,
} from "../../src/utils/extract-image-metadata";

const SMALL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SVG = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#ff0000"/></svg>`,
  "utf8",
);

async function largePng() {
  return sharp({
    create: {
      width: 2200,
      height: 1800,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

const WOFF2_FONT = Buffer.from([
  0x77, 0x4f, 0x46, 0x32, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00,
]);

const uploadedStorageKeys: string[] = [];

async function uploadToS3(signedUrl: string, buffer: Buffer, contentType: string) {
  const resp = await fetch(signedUrl, {
    method: "PUT",
    body: buffer,
    headers: { "Content-Type": contentType },
  });
  if (!resp.ok) {
    throw new Error(`S3 PUT failed: ${resp.status} ${await resp.text()}`);
  }
}

async function createAssetViaApi(
  app: Awaited<ReturnType<typeof build>>,
  filename: string,
  contentType: string,
  type: string,
  buffer: Buffer,
) {
  const workspaceUuid = await getTestWorkspaceUuid();
  const uploadUrlResp = await app.inject({
    method: "GET",
    url: `/api/assets/upload-url?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(contentType)}`,
    headers: authHeaders(),
  });
  expect(uploadUrlResp.statusCode).toBe(200);
  const { signedUrl, publicUrl, storageKey } = JSON.parse(uploadUrlResp.body);

  await uploadToS3(signedUrl, buffer, contentType);
  uploadedStorageKeys.push(storageKey);

  const createResp = await app.inject({
    method: "POST",
    url: "/api/assets",
    headers: authHeaders(),
    payload: {
      name: filename,
      type,
      source: "upload",
      mimeType: contentType,
      url: publicUrl,
      storageKey,
    },
  });
  expect(createResp.statusCode).toBe(201);
  const asset = JSON.parse(createResp.body);

  return { workspaceUuid, asset, publicUrl, storageKey };
}

describe("asset real-S3 integration", () => {
  beforeEach(() => {
    uploadedStorageKeys.length = 0;
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    const app = await build();
    for (const storageKey of uploadedStorageKeys) {
      try {
        await app.storage.deleteObject(storageKey);
      } catch {
        // ignore cleanup errors
      }
    }
    await app.close();
  });

  test("upload a small PNG and expose signed + public URLs", async () => {
    const app = await build();
    const { asset, publicUrl, storageKey } = await createAssetViaApi(
      app,
      "small-asset.png",
      "image/png",
      "image",
      SMALL_PNG,
    );

    console.log("\n--- small PNG upload ---");
    console.log("asset uuid:", asset.uuid);
    console.log("public URL:", publicUrl);
    console.log("signed URL:", asset.signedUrl);
    console.log("storage key:", storageKey);

    expect(asset.uuid).toBeDefined();
    expect(asset.type).toBe("image");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.url).toBe(publicUrl);
    expect(asset.signedUrl).toContain(storageKey);

    await app.close();
  });

  test("upload a large PNG and verify prepareImageForVision downscales it", async () => {
    const app = await build();
    const big = await largePng();
    const { asset, publicUrl } = await createAssetViaApi(
      app,
      "large-asset.png",
      "image/png",
      "image",
      big,
    );

    // app.inject returns the body as a UTF-8 string, which corrupts binary.
    // Fetch the signed URL to inspect the actual bytes.
    const imageResp = await fetch(asset.signedUrl);
    expect(imageResp.status).toBe(200);
    const imageBuffer = Buffer.from(await imageResp.arrayBuffer());

    const localMetadata = await extractImageMetadata(imageBuffer, "image/png");
    const prepared = await prepareImageForVision(imageBuffer, "image/png");
    const preparedMetadata = await sharp(prepared.buffer).metadata();

    expect(Math.max(localMetadata.width ?? 0, localMetadata.height ?? 0)).toBe(2200);
    expect(Math.max(preparedMetadata.width ?? 0, preparedMetadata.height ?? 0)).toBeLessThanOrEqual(1024);
    expect(prepared.mimeType).toBe("image/jpeg");

    console.log("\n--- large PNG upload ---");
    console.log("asset uuid:", asset.uuid);
    console.log("public URL:", publicUrl);
    console.log("original dimensions:", `${localMetadata.width}x${localMetadata.height}`);
    console.log("prepared dimensions:", `${preparedMetadata.width}x${preparedMetadata.height}`);
    console.log("prepared mime type:", prepared.mimeType);
    console.log("dominant colors:", localMetadata.dominantColors);

    await app.close();
  });

  test("upload an SVG and see metadata without invoking raster processing", async () => {
    const app = await build();
    const { asset, publicUrl } = await createAssetViaApi(
      app,
      "logo.svg",
      "image/svg+xml",
      "image",
      SVG,
    );

    const raw = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.uuid}/raw`,
      headers: authHeaders(),
    });
    expect(raw.statusCode).toBe(200);
    expect(raw.body).toContain("<svg");

    console.log("\n--- SVG upload ---");
    console.log("asset uuid:", asset.uuid);
    console.log("public URL:", publicUrl);
    console.log("raw body starts with:", raw.body.slice(0, 80));

    await app.close();
  });

  test("upload a WOFF2 font and skip classification", async () => {
    const app = await build();
    const classifyAddSpy = vi
      .spyOn(app.queues.classifyAssets.queue, "add")
      .mockResolvedValue({ id: "demo-classify" } as Awaited<
        ReturnType<typeof app.queues.classifyAssets.queue.add>
      >);

    const { asset, publicUrl } = await createAssetViaApi(
      app,
      "body-text.woff2",
      "font/woff2",
      "font",
      WOFF2_FONT,
    );

    expect(asset.type).toBe("font");
    expect(asset.mimeType).toBe("font/woff2");
    expect(classifyAddSpy).not.toHaveBeenCalled();

    console.log("\n--- WOFF2 font upload ---");
    console.log("asset uuid:", asset.uuid);
    console.log("public URL:", publicUrl);
    console.log("classification skipped:", true);

    await app.close();
  });

  test("delete an asset removes the S3 object", async () => {
    const app = await build();
    const { asset, publicUrl, storageKey } = await createAssetViaApi(
      app,
      "delete-me.png",
      "image/png",
      "image",
      SMALL_PNG,
    );

    console.log("\n--- delete asset cleanup ---");
    console.log("asset uuid:", asset.uuid);
    console.log("public URL (should 404 after delete):", publicUrl);

    const delResp = await app.inject({
      method: "DELETE",
      url: `/api/assets/${asset.uuid}`,
      headers: authHeaders(),
    });
    expect(delResp.statusCode).toBe(204);

    // Remove from cleanup list since we already deleted it.
    const idx = uploadedStorageKeys.indexOf(storageKey);
    if (idx >= 0) uploadedStorageKeys.splice(idx, 1);

    const rawAfterDelete = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.uuid}/raw`,
      headers: authHeaders(),
    });
    expect(rawAfterDelete.statusCode).toBe(404);

    await app.close();
  });

  test("use your own fixture by swapping the buffer", async () => {
    // To test with a real file, drop it at test/fixtures/demo.png and uncomment:
    // const buffer = await fs.readFile("./test/fixtures/demo.png");
    // const { asset, publicUrl } = await createAssetViaApi(app, "demo.png", "image/png", "image", buffer);

    const app = await build();
    const { asset, publicUrl } = await createAssetViaApi(
      app,
      "your-fixture.png",
      "image/png",
      "image",
      SMALL_PNG,
    );

    console.log("\n--- your fixture placeholder ---");
    console.log("asset uuid:", asset.uuid);
    console.log("GET /api/assets/${asset.uuid}:", `http://localhost:3000/api/assets/${asset.uuid}`);
    console.log("GET /api/assets/${asset.uuid}/raw:", `http://localhost:3000/api/assets/${asset.uuid}/raw`);
    console.log("public URL:", publicUrl);

    await app.close();
  });
});
