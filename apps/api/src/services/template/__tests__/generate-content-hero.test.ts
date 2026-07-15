import { describe, it, expect } from "vitest";
import {
  findMirrorAssetByUrl,
  isUsableHeroImage,
  findHeroImage,
} from "../generate-content.js";
import { buildImageMatcher } from "../../mirror/image-matcher.js";
import { NO_IMAGE } from "@milo/shared-types";
import type { MirrorAsset } from "../../../types/mirror.js";

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
});
