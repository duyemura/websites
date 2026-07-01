import { describe, expect, test } from "vitest";
import {
  canRegenerateAnalysis,
  getAnalysisQualityLabel,
  getAssetDescription,
  getAssetSourceLabel,
  getAssetTags,
  isAssetAnalyzed,
  needsAnalysisReview,
} from "../../src/lib/assets";
import type { Asset } from "../../src/lib/api";

function asset(partial: Partial<Asset> & { uuid: string }): Asset {
  return {
    uuid: partial.uuid,
    workspaceUuid: "ws-1",
    name: partial.name ?? "Asset",
    type: partial.type ?? "image",
    source: partial.source ?? "upload",
    url: "https://example.com/asset.png",
    signedUrl: "https://example.com/asset.png",
    storageKey: "asset.png",
    metadata: partial.metadata ?? null,
    createdAt: "2026-06-30T00:00:00Z",
    ...partial,
  };
}

describe("getAssetTags", () => {
  test("merges metadata tags, analysis tags, and the type tag", () => {
    const a = asset({
      uuid: "1",
      type: "image",
      metadata: {
        tags: ["user-uploaded"],
        analysis: {
          tags: ["logo"],
          confidence: 1,
          context: "other",
          description: "",
          altText: "",
          model: "",
          version: 1,
          technical: { hasText: false, textConfidence: 0 },
          quality: {
            score: 5,
            resolution: "high",
            sharpness: "sharp",
            issues: [],
          },
          marketing: { mood: "", useCases: [], subject: "" },
          safety: { hasIdentifiablePeople: false, needsReview: false },
        },
      },
    });
    const tags = getAssetTags(a);
    expect(tags).toContain("user-uploaded");
    expect(tags).toContain("logo");
    expect(tags).toContain("photograph");
  });

  test("ignores unknown tags", () => {
    const a = asset({
      uuid: "2",
      metadata: { tags: ["unknown-tag"] },
    });
    expect(getAssetTags(a)).not.toContain("unknown-tag");
  });
});

describe("isAssetAnalyzed", () => {
  test("returns true when analysis is present", () => {
    const a = asset({
      uuid: "3",
      metadata: {
        analysis: {
          confidence: 1,
          context: "other",
          description: "",
          altText: "",
          model: "",
          version: 1,
          technical: { hasText: false, textConfidence: 0 },
          quality: {
            score: 3,
            resolution: "medium",
            sharpness: "good",
            issues: [],
          },
          marketing: { mood: "", useCases: [], subject: "" },
          safety: { hasIdentifiablePeople: false, needsReview: false },
        },
      },
    });
    expect(isAssetAnalyzed(a)).toBe(true);
  });

  test("returns false when analysis is missing", () => {
    expect(isAssetAnalyzed(asset({ uuid: "4" }))).toBe(false);
  });
});

describe("needsAnalysisReview", () => {
  test("reads safety.needsReview", () => {
    const a = asset({
      uuid: "5",
      metadata: {
        analysis: {
          confidence: 1,
          context: "other",
          description: "",
          altText: "",
          model: "",
          version: 1,
          technical: { hasText: false, textConfidence: 0 },
          quality: {
            score: 3,
            resolution: "medium",
            sharpness: "good",
            issues: [],
          },
          marketing: { mood: "", useCases: [], subject: "" },
          safety: { hasIdentifiablePeople: false, needsReview: true },
        },
      },
    });
    expect(needsAnalysisReview(a)).toBe(true);
  });

  test("defaults to false when safety is missing", () => {
    const a = asset({
      uuid: "6",
      metadata: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        analysis: { safety: undefined } as any,
      },
    });
    expect(needsAnalysisReview(a)).toBe(false);
  });
});

describe("getAnalysisQualityLabel", () => {
  test.each([
    [5, "High quality"],
    [4, "High quality"],
    [3, "Average quality"],
    [2, "Low quality"],
    [1, "Low quality"],
    [null, null],
  ])("score %s returns %s", (score, expected) => {
    const a = asset({
      uuid: "7",
      metadata: {
        analysis: {
          confidence: 1,
          context: "other",
          description: "",
          altText: "",
          model: "",
          version: 1,
          technical: { hasText: false, textConfidence: 0 },
          quality: {
            score: score as number,
            resolution: "medium",
            sharpness: "good",
            issues: [],
          },
          marketing: { mood: "", useCases: [], subject: "" },
          safety: { hasIdentifiablePeople: false, needsReview: false },
        },
      },
    });
    expect(getAnalysisQualityLabel(a)).toBe(expected);
  });
});

describe("getAssetDescription", () => {
  test("prefers metadata.description over analysis.description", () => {
    const a = asset({
      uuid: "8",
      metadata: {
        description: "manual",
        analysis: {
          confidence: 1,
          context: "other",
          description: "ai",
          altText: "",
          model: "",
          version: 1,
          technical: { hasText: false, textConfidence: 0 },
          quality: {
            score: 3,
            resolution: "medium",
            sharpness: "good",
            issues: [],
          },
          marketing: { mood: "", useCases: [], subject: "" },
          safety: { hasIdentifiablePeople: false, needsReview: false },
        },
      },
    });
    expect(getAssetDescription(a)).toBe("manual");
  });
});

describe("canRegenerateAnalysis", () => {
  test("allows images that are not screenshots", () => {
    expect(
      canRegenerateAnalysis(asset({ uuid: "9", type: "image", source: "upload" })),
    ).toBe(true);
  });

  test("disallows screenshots", () => {
    expect(
      canRegenerateAnalysis(asset({ uuid: "10", type: "image", source: "screenshot" })),
    ).toBe(false);
  });

  test("disallows non-images", () => {
    expect(
      canRegenerateAnalysis(asset({ uuid: "11", type: "video", source: "upload" })),
    ).toBe(false);
  });
});

describe("getAssetSourceLabel", () => {
  test.each([
    ["upload", "Upload"],
    ["scraped", "Scraped"],
    ["screenshot", "Screenshot"],
    ["ai_generated", "AI generated"],
  ] as const)("%s → %s", (source, expected) => {
    expect(getAssetSourceLabel(source)).toBe(expected);
  });
});
