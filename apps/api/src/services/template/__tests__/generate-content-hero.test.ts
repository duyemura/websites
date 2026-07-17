import { describe, it, expect, vi } from "vitest";
import {
  findMirrorAssetByUrl,
  isUsableHeroImage,
  findHeroImage,
  generateStaticPageHeadlines,
} from "../generate-content.js";
import { buildImageMatcher } from "../../mirror/image-matcher.js";
import { NO_IMAGE } from "@milo/shared-types";
import type { MirrorAsset } from "../../../types/mirror.js";

vi.mock("../../../ai/llm-client", () => ({
  chatCompletion: vi.fn(),
}));
import { chatCompletion } from "../../../ai/llm-client";
const mockedChatCompletion = vi.mocked(chatCompletion);

function makeConfig() {
  return {
    DEFAULT_LLM_MODEL: "test-model",
    LLM_PROVIDER: "openrouter",
    OPENROUTER_BASE_URL: "https://test",
    OPENROUTER_API_KEY: "key",
  } as any;
}

function photo(localPath: string, width: number, height: number, tags?: string[]): MirrorAsset {
  return {
    originalUrl: `https://example.com${localPath}`,
    storageKey: `sites/x/${localPath}`,
    localPath,
    contentType: "image/jpeg",
    width,
    height,
    visionTags: tags,
  };
}

describe("findMirrorAssetByUrl", () => {
  const assets: MirrorAsset[] = [photo("/_assets/hero.jpg", 1200, 600)];

  it("looks up assets by local path", () => {
    expect(findMirrorAssetByUrl("/_assets/hero.jpg", assets)?.localPath).toBe("/_assets/hero.jpg");
  });

  it("extracts local path from absolute CDN URLs", () => {
    expect(
      findMirrorAssetByUrl("https://cdn.example.com/sites/x/_assets/hero.jpg", assets)?.localPath,
    ).toBe("/_assets/hero.jpg");
  });

  it("returns undefined for unknown URLs", () => {
    expect(findMirrorAssetByUrl("/_assets/missing.jpg", assets)).toBeUndefined();
  });
});

describe("isUsableHeroImage", () => {
  const assets: MirrorAsset[] = [
    photo("/_assets/big.jpg", 1200, 600),
    photo("/_assets/small.jpg", 256, 256),
  ];

  it("accepts a large-enough image", () => {
    expect(isUsableHeroImage("/_assets/big.jpg", assets)).toBe(true);
  });

  it("rejects a tiny image", () => {
    expect(isUsableHeroImage("/_assets/small.jpg", assets)).toBe(false);
  });

  it("rejects NO_IMAGE and empty URLs", () => {
    expect(isUsableHeroImage(NO_IMAGE, assets)).toBe(false);
    expect(isUsableHeroImage("", assets)).toBe(false);
  });

  it("is permissive for external URLs without a matching asset record", () => {
    expect(isUsableHeroImage("https://example.com/photo.jpg", assets)).toBe(true);
  });

  it("rejects logo/branding assets even if dimensions are large", () => {
    const logoAssets: MirrorAsset[] = [photo("/_assets/logo.png", 1200, 600, ["logo", "branding"])];
    expect(isUsableHeroImage("/_assets/logo.png", logoAssets)).toBe(false);
  });

  it("rejects non-image assets", () => {
    const nonImageAssets: MirrorAsset[] = [{
      originalUrl: "https://example.com/file.bin",
      localPath: "/_assets/file.bin",
      storageKey: "file.bin",
      contentType: "application/octet-stream",
    }];
    expect(isUsableHeroImage("/_assets/file.bin", nonImageAssets)).toBe(false);
  });
});

describe("findHeroImage", () => {
  it("keeps a usable candidate", () => {
    const assets: MirrorAsset[] = [photo("/_assets/hero.jpg", 1200, 600)];
    const matcher = buildImageMatcher(assets);
    const used = new Set<string>();
    expect(findHeroImage({ candidate: "External photo", context: "about hero", imageMatcher: matcher, assets, used })).toBe("External photo");
  });

  it("falls back from a tiny candidate to a contextual match", () => {
    const assets: MirrorAsset[] = [
      photo("/_assets/tiny.png", 128, 128),
      photo("/_assets/about.jpg", 1200, 600, ["about", "team"]),
    ];
    const matcher = buildImageMatcher(assets);
    const used = new Set<string>();
    expect(
      findHeroImage({
        candidate: "/_assets/tiny.png",
        context: "about page hero",
        imageMatcher: matcher,
        assets,
        used,
      }),
    ).toBe("/_assets/about.jpg");
  });

  it("falls back to the next usable photo when the best match is too small", () => {
    const assets: MirrorAsset[] = [
      photo("/_assets/hero-small.png", 200, 100, ["hero"]),
      photo("/_assets/hero-large.jpg", 1400, 700, ["hero"]),
    ];
    const matcher = buildImageMatcher(assets);
    const used = new Set<string>();
    expect(
      findHeroImage({
        candidate: undefined,
        context: "homepage hero",
        imageMatcher: matcher,
        assets,
        used,
      }),
    ).toBe("/_assets/hero-large.jpg");
  });

  it("returns NO_IMAGE when nothing is usable", () => {
    const assets: MirrorAsset[] = [photo("/_assets/tiny.png", 100, 100)];
    const matcher = buildImageMatcher(assets);
    const used = new Set<string>();
    expect(
      findHeroImage({
        candidate: undefined,
        context: "about page hero",
        imageMatcher: matcher,
        assets,
        used,
      }),
    ).toBe(NO_IMAGE);
  });

  it("never falls back to a logo asset", () => {
    const assets: MirrorAsset[] = [
      photo("/_assets/logo.png", 1200, 600, ["logo"]),
      photo("/_assets/gym-floor.jpg", 1200, 600, ["facility"]),
    ];
    const matcher = buildImageMatcher(assets);
    const used = new Set<string>();
    expect(
      findHeroImage({
        candidate: undefined,
        context: "about page hero",
        imageMatcher: matcher,
        assets,
        used,
      }),
    ).toBe("/_assets/gym-floor.jpg");
  });
});

describe("generateStaticPageHeadlines", () => {
  it("returns natural H1s from nav labels, prefixing 'Our' only when appropriate", async () => {
    mockedChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify({
        about: "About Us",
        pricing: "Our Rates",
        schedule: "Our Schedule",
        contact: "Contact",
        blog: "Our Blog",
      }),
    });
    const logs: string[] = [];
    const result = await generateStaticPageHeadlines({
      config: makeConfig(),
      businessName: "Test Gym",
      category: "CrossFit gym",
      city: "Torrance",
      inputs: [
        { pageKey: "about", navLabel: "About Us", currentHeadline: "About us" },
        { pageKey: "pricing", navLabel: "Rates", currentHeadline: "Pricing" },
        { pageKey: "schedule", navLabel: "Schedule", currentHeadline: "Class schedule" },
        { pageKey: "contact", navLabel: "Contact", currentHeadline: "Get in touch" },
        { pageKey: "blog", navLabel: "Blogs", currentHeadline: "Blog" },
      ],
      log: (msg) => logs.push(msg),
    });
    expect(result).toEqual({
      about: "About Us",
      pricing: "Our Rates",
      schedule: "Our Schedule",
      contact: "Contact",
      blog: "Our Blog",
    });
  });

  it("returns null after two failed attempts", async () => {
    mockedChatCompletion.mockResolvedValue({ content: "not json" });
    const logs: string[] = [];
    const result = await generateStaticPageHeadlines({
      config: makeConfig(),
      businessName: "Test Gym",
      category: "gym",
      inputs: [{ pageKey: "pricing", navLabel: "Rates", currentHeadline: "Pricing" }],
      log: (msg) => logs.push(msg),
    });
    expect(result).toBeNull();
    expect(logs.some((m) => m.includes("static headlines attempt 2") && m.includes("warn"))).toBe(true);
  });
});
