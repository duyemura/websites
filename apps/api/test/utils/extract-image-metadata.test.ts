import { describe, test, expect } from "vitest";
import sharp from "sharp";
import {
  extractImageMetadata,
  prepareImageForVision,
  bufferToDataUrl,
} from "../../src/utils/extract-image-metadata";

describe("extractImageMetadata", () => {
  test("extracts dimensions and format from a PNG", async () => {
    const buffer = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const meta = await extractImageMetadata(buffer);

    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
    expect(meta.format).toBe("png");
    expect(meta.hasTransparency).toBe(false);
    expect(meta.fileSize).toBe(buffer.length);
  });

  test("detects transparency in a PNG", async () => {
    const buffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const meta = await extractImageMetadata(buffer);
    expect(meta.hasTransparency).toBe(true);
  });

  test("returns a dominant color", async () => {
    const buffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .jpeg()
      .toBuffer();

    const meta = await extractImageMetadata(buffer);
    expect(meta.dominantColors).toBeDefined();
    expect(meta.dominantColors!.length).toBeGreaterThan(0);
  });

  test("extracts SVG metadata without invoking sharp", async () => {
    const buffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 75"><rect width="150" height="75"/></svg>',
    );

    const meta = await extractImageMetadata(buffer, "image/svg+xml");
    expect(meta.format).toBe("svg");
    expect(meta.width).toBe(150);
    expect(meta.height).toBe(75);
    expect(meta.fileSize).toBe(buffer.length);
  });
});

describe("prepareImageForVision", () => {
  test("downscales an oversized image", async () => {
    const buffer = await sharp({
      create: {
        width: 2000,
        height: 1500,
        channels: 3,
        background: { r: 0, g: 0, b: 255 },
      },
    })
      .jpeg()
      .toBuffer();

    const prepared = await prepareImageForVision(buffer);
    const preparedMeta = await sharp(prepared.buffer).metadata();

    expect(preparedMeta.width).toBeLessThanOrEqual(1024);
    expect(preparedMeta.height).toBeLessThanOrEqual(1024);
    expect(prepared.mimeType).toBe("image/jpeg");
  });

  test("keeps PNG format for transparent images", async () => {
    const buffer = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const prepared = await prepareImageForVision(buffer);
    expect(prepared.mimeType).toBe("image/png");
  });

  test("returns SVG data URL unchanged", async () => {
    const buffer = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>',
    );

    const prepared = await prepareImageForVision(buffer, "image/svg+xml");
    expect(prepared.mimeType).toBe("image/svg+xml");
    expect(prepared.buffer.toString("utf8")).toContain("svg");
  });
});

describe("bufferToDataUrl", () => {
  test("encodes a buffer as a data URL", () => {
    const buffer = Buffer.from("hello");
    const url = bufferToDataUrl(buffer, "text/plain");
    expect(url).toBe("data:text/plain;base64,aGVsbG8=");
  });
});
