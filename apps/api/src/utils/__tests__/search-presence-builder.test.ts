import { describe, expect, it } from "vitest";
import { buildSearchPresence } from "../search-presence-builder";
import type { ExtractArtifact } from "../../types/pipeline-artifacts";

function stubExtract(): ExtractArtifact {
  return {
    url: "https://example.com",
    extractedAt: "2026-07-03T00:00:00.000Z",
    siteMap: [
      {
        url: "https://example.com/",
        path: "/",
        title: "Home",
        classification: "structural",
        source: "sitemap",
        status: "captured",
      },
      {
        url: "https://example.com/about",
        path: "/about",
        title: "About",
        classification: "structural",
        source: "nav",
        status: "captured",
      },
    ],
    css: { tokens: {}, breakpoints: [], animations: [] },
    pages: [
      {
        path: "/",
        media: [],
        screenshots: {
          full1440: "s3://f",
          vp768: "s3://a",
          vp375: "s3://b",
        },
        content: {
          title: "Home Title",
          headings: [
            { level: 1, text: "Welcome" },
            { level: 2, text: "Classes" },
          ],
          navLinks: [],
          meta: {
            "og:title": "Home OG",
            description: "Home description",
            "og:description": "Home OG description",
            canonical: "https://example.com/",
          },
          jsonLd: [
            { "@type": "Organization", name: "Ex" },
            [{ "@type": "LocalBusiness" }],
          ],
          iframes: [],
          videos: [],
        },
        interactions: [],
        responsive: [],
        pixelSamples: [],
        flags: { needsVisionSegmentation: false, isSpa: false },
      },
      {
        path: "/about",
        media: [],
        screenshots: {
          full1440: "s3://f2",
          vp768: "s3://a2",
          vp375: "s3://b2",
        },
        content: {
          title: "About Title",
          headings: [{ level: 1, text: "About us" }],
          navLinks: [],
          meta: {},
          jsonLd: [],
          iframes: [],
          videos: [],
        },
        interactions: [],
        responsive: [],
        pixelSamples: [],
        flags: { needsVisionSegmentation: false, isSpa: false },
      },
    ],
    sourceBaseline: {
      capturedAt: "2026-07-03T00:00:00.000Z",
      lighthouse: [
        {
          path: "/",
          preset: "mobile",
          performance: 90,
          seo: 95,
          accessibility: 92,
          bestPractices: 90,
        },
      ],
      axe: [],
      network: [],
    },
    usage: { pagesCaptured: 2, screenshotCount: 6 },
  };
}

describe("buildSearchPresence", () => {
  it("captures per-page meta, canonical, og tags, headings and jsonLd schema types", () => {
    const sp = buildSearchPresence(stubExtract());
    expect(sp.version).toBe("1");
    expect(sp.pages).toHaveLength(2);

    const home = sp.pages[0]!;
    expect(home.path).toBe("/");
    expect(home.metaTitle).toBe("Home OG");
    expect(home.metaDescription).toBe("Home description");
    expect(home.canonical).toBe("https://example.com/");
    expect(home.ogTags).toEqual({
      "og:title": "Home OG",
      "og:description": "Home OG description",
    });
    expect(home.schemaTypes).toEqual(["Organization", "LocalBusiness"]);
    expect(home.headingOutline).toHaveLength(2);

    const about = sp.pages[1]!;
    expect(about.metaTitle).toBe("About Title");
    expect(about.canonical).toBeUndefined();
  });

  it("detects sitemap presence and captures baseline + topic footprint", () => {
    const sp = buildSearchPresence(stubExtract());
    expect(sp.sitemapPresent).toBe(true);
    expect(sp.baseline.lighthouse[0]?.seo).toBe(95);
    expect(sp.topicFootprint).toEqual(
      expect.arrayContaining(["welcome", "classes", "about us"]),
    );
  });
});
