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

  test("captures iframe widgets as scraped sections before stripping them", async () => {
    const html = `
      <html><body>
        <section>
          <h2>What our members say</h2>
          <iframe src="https://widgets.trustpilot.com/reviews/123" title="Member reviews"></iframe>
        </section>
        <section>
          <iframe src="javascript:alert(1)"></iframe>
        </section>
      </body></html>
    `;
    const { crawl, s3, config } = makeCrawl(html);
    const data = await buildScrapedWebsiteDataFromCrawl(crawl, s3, config);

    const iframeSections = data.sections?.filter((s) => s.type === "iframe") ?? [];
    expect(iframeSections).toHaveLength(1);
    expect(iframeSections[0]).toMatchObject({
      type: "iframe",
      widgetUrl: "https://widgets.trustpilot.com/reviews/123",
      heading: "What our members say",
    });
  });

  test("extracts team members with photos from coach/team sections", async () => {
    const html = `
      <html><body>
        <section class="team-section">
          <h2>Meet our coaches</h2>
          <div class="team-grid">
            <article>
              <img src="/img/coach-alex.jpg" alt="Alex Rivera" />
              <h3>Alex Rivera</h3>
              <p class="role">Head coach</p>
              <p>Former competitive athlete with 10 years of coaching experience.</p>
            </article>
            <article>
              <img src="https://example.com/img/coach-jordan.jpg" alt="Jordan Lee" />
              <h3>Jordan Lee</h3>
              <p class="role">Assistant coach</p>
            </article>
          </div>
        </section>
      </body></html>
    `;
    const { crawl, s3, config } = makeCrawl(html);
    const data = await buildScrapedWebsiteDataFromCrawl(crawl, s3, config);

    expect(data.team).toHaveLength(2);
    expect(data.team).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Alex Rivera",
          role: "Head coach",
          photoUrl: "https://example.com/img/coach-alex.jpg",
        }),
        expect.objectContaining({
          name: "Jordan Lee",
          role: "Assistant coach",
          photoUrl: "https://example.com/img/coach-jordan.jpg",
        }),
      ]),
    );
  });

  test("drops unsafe URLs from nav links, CTAs, images, and team photos", async () => {
    const html = `
      <html><body>
        <header>
          <nav>
            <a href="/safe">Home</a>
            <a href="javascript:alert(1)">Bad link</a>
            <a href="data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;">Data link</a>
          </nav>
        </header>
        <section class="team-section">
          <article>
            <img src="javascript:alert(1)" alt="Unsafe" />
            <h3>Mallory</h3>
            <a href="data:text/html,unsafe">Bad CTA</a>
          </article>
          <article>
            <img src="/img/safe.jpg" alt="Safe" />
            <h3>Sam</h3>
          </article>
        </section>
        <img src="data:image/svg+xml,..." alt="Unsafe image" />
      </body></html>
    `;
    const { crawl, s3, config } = makeCrawl(html);
    const data = await buildScrapedWebsiteDataFromCrawl(crawl, s3, config);

    expect(data.navLinks).toEqual([{ label: "Home", href: "/safe" }]);
    expect(data.images).toEqual(
      expect.arrayContaining([expect.objectContaining({ url: "/img/safe.jpg" })]),
    );
    expect(data.images.some((i) => i.url.startsWith("data:"))).toBe(false);
    expect(data.team).toHaveLength(2);
    const mallory = data.team.find((m) => m.name === "Mallory");
    expect(mallory?.photoUrl).toBeUndefined();
    const sam = data.team.find((m) => m.name === "Sam");
    expect(sam?.photoUrl).toBe("https://example.com/img/safe.jpg");
  });
});
