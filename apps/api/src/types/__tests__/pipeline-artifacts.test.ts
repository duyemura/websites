import { describe, expect, it } from "vitest";
import {
  ExtractArtifactSchema,
  SegmentArtifactSchema,
  VerifyArtifactSchema,
} from "../pipeline-artifacts";

const minimalExtract = {
  url: "https://example.com",
  extractedAt: "2026-07-03T00:00:00.000Z",
  siteMap: [
    {
      url: "https://example.com/",
      path: "/",
      title: "Home",
      classification: "structural",
      source: "nav",
      status: "captured",
    },
  ],
  css: { tokens: { "--brand": "#E63946" }, breakpoints: ["(min-width: 768px)"], animations: [] },
  pages: [
    {
      path: "/",
      media: [],
      screenshots: { full1440: "s3://a", vp375: "s3://b", vp768: "s3://c" },
      content: { title: "Home", headings: [], navLinks: [], meta: {}, jsonLd: [], iframes: [], videos: [] },
      interactions: [],
      responsive: [],
      pixelSamples: [],
      flags: { needsVisionSegmentation: false, isSpa: false },
    },
  ],
  sourceBaseline: { capturedAt: "2026-07-03T00:00:00.000Z", lighthouse: [], axe: [], network: [] },
  usage: { pagesCaptured: 1, screenshotCount: 3 },
};

describe("pipeline artifact schemas", () => {
  it("accepts a minimal valid extract artifact", () => {
    expect(() => ExtractArtifactSchema.parse(minimalExtract)).not.toThrow();
  });

  it("rejects an extract artifact with a bad classification", () => {
    const bad = structuredClone(minimalExtract);
    bad.siteMap[0].classification = "blog";
    expect(() => ExtractArtifactSchema.parse(bad)).toThrow();
  });

  it("rejects a segment artifact with confidence out of range", () => {
    expect(() =>
      SegmentArtifactSchema.parse({
        siteUuid: "0".repeat(36),
        sourceExtractAt: "2026-07-03T00:00:00.000Z",
        pages: [
          {
            path: "/",
            sections: [
              {
                id: "seg-0", tag: "hero", order: 0, confidence: 1.4, source: "semantic",
                boundingBox: { x: 0, y: 0, width: 100, height: 100 },
                crops: { desktop: "s3://d", mobile: "s3://m" },
                innerText: "", mediaUrls: [], interactionIds: [],
              },
            ],
            ladder: { rung1Count: 1, rung2Used: false, visionUsed: false },
          },
        ],
        sharedComponents: [],
      }),
    ).toThrow();
  });

  it("accepts a verify artifact with scores and improvements", () => {
    expect(() =>
      VerifyArtifactSchema.parse({
        pages: [{ path: "/", mechanical: { passed: [], failed: [] }, vision: { score1440: 90, score375: 85, differences: [] } }],
        scores: {
          mechanicalFidelity: 92, visualFidelity: 88, masterFidelity: 90,
          quality: {
            performance: { clone: 97, original: 34, delta: 63 },
            seo: { clone: 100, original: 60, delta: 40 },
            accessibility: { clone: 95, original: 50, delta: 45 },
          },
        },
        improvements: [{ category: "seo", source: "baseline-diff", description: "Added LocalBusiness schema" }],
        actionable: [],
      }),
    ).not.toThrow();
  });
});
