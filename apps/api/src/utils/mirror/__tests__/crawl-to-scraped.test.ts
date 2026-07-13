// @vitest-environment node
import { describe, test, expect, vi } from "vitest";
import { buildScrapedWebsiteDataFromCrawl } from "../crawl-to-scraped";
import type { MirrorCrawlArtifact, MirrorPage } from "../../../types/mirror";

function makeCrawl(html: string): {
  crawl: MirrorCrawlArtifact;
  s3: { send: ReturnType<typeof vi.fn> };
  config: Record<string, string>;
} {
  const homePage: MirrorPage = {
    url: "https://example.com/",
    path: "/",
    title: "Example Gym",
    htmlKey: "sites/test/index.html",
    forms: [],
    dynamicRegions: [],
    embeds: [],
    category: "structural",
  };
  const crawl: MirrorCrawlArtifact = {
    sourceUrl: "https://example.com",
    origin: "https://example.com",
    pages: [homePage],
    redirects: [],
    sitemapXml: null,
    robotsTxt: null,
    failures: [],
    ugcRegistry: [],
  };

  const s3 = {
    send: vi.fn().mockResolvedValue({
      Body: {
        transformToString: vi.fn().mockResolvedValue(html),
      },
    }),
  };

  const config = {
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "x",
    S3_SECRET_KEY: "x",
    S3_ASSETS_BUCKET: "bucket",
  };

  return { crawl, s3, config };
}

describe("buildScrapedWebsiteDataFromCrawl", () => {
  test("extracts a bright saturated accent as primary color", async () => {
    const html = `
      <html>
        <head>
          <style>
            body { color: #333333; background: #ffffff; }
            .btn { background-color: #0063ff; }
          </style>
        </head>
        <body>
          <section style="background-color: #0063ff;">Hero</section>
          <p>Welcome</p>
        </body>
      </html>
    `;
    const { crawl, s3, config } = makeCrawl(html);
    const data = await buildScrapedWebsiteDataFromCrawl(crawl, s3, config);

    expect(data.colors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "accent", hex: "#0063ff" }),
        expect.objectContaining({ role: "background", hex: "#ffffff" }),
        expect.objectContaining({ role: "text", hex: "#333333" }),
      ]),
    );
  });

  test("ignores pure black/white when picking a brand accent", async () => {
    const html = `
      <html>
        <head>
          <style>
            body { background: #ffffff; color: #000000; }
            .cta { background-color: #e63946; }
          </style>
        </head>
        <body>
          <a class="cta">Join now</a>
        </body>
      </html>
    `;
    const { crawl, s3, config } = makeCrawl(html);
    const data = await buildScrapedWebsiteDataFromCrawl(crawl, s3, config);

    const accent = data.colors.find((c) => c.role === "accent");
    expect(accent?.hex).toBe("#e63946");
  });

  test("returns empty colors when no usable colors are present", async () => {
    const html = `<html><body><p>No colors here</p></body></html>`;
    const { crawl, s3, config } = makeCrawl(html);
    const data = await buildScrapedWebsiteDataFromCrawl(crawl, s3, config);
    expect(data.colors).toEqual([]);
  });
});
