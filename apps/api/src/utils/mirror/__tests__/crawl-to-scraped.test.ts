// @vitest-environment node
import { describe, test, expect, vi } from "vitest";
import { buildScrapedWebsiteDataFromCrawl, extractCrawlPageIframes } from "../crawl-to-scraped";
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

function makeCrawlWithPages(
  pages: { path: string; htmlKey: string; html: string; embeds?: string[]; dynamicRegions?: MirrorPage["dynamicRegions"] }[],
): {
  crawl: MirrorCrawlArtifact;
  s3: { send: ReturnType<typeof vi.fn> };
} {
  const crawlPages: MirrorPage[] = pages.map((p) => ({
    url: `https://example.com${p.path}`,
    path: p.path,
    title: "Page",
    htmlKey: p.htmlKey,
    forms: [],
    dynamicRegions: p.dynamicRegions ?? [],
    embeds: p.embeds ?? [],
    category: "structural",
  }));

  const htmlByKey = new Map(pages.map((p) => [p.htmlKey, p.html]));
  const s3 = {
    send: vi.fn().mockImplementation((command: { input: { Key: string } }) => {
      const key = command.input.Key;
      const html = htmlByKey.get(key) ?? "";
      return Promise.resolve({
        Body: {
          transformToString: vi.fn().mockResolvedValue(html),
        },
      });
    }),
  };

  const crawl: MirrorCrawlArtifact = {
    sourceUrl: "https://example.com",
    origin: "https://example.com",
    pages: crawlPages,
    redirects: [],
    sitemapXml: null,
    robotsTxt: null,
    failures: [],
    ugcRegistry: [],
  };

  return { crawl, s3 };
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

describe("extractCrawlPageIframes", () => {
  test("extracts schedule and form iframes from interior pages", async () => {
    const { crawl, s3 } = makeCrawlWithPages([
      {
        path: "/",
        htmlKey: "index.html",
        html: `<html><body>
          <section><h2>Reviews</h2>
            <iframe src="https://widgets.trustpilot.com/reviews/123" title="Member reviews"></iframe>
          </section>
        </body></html>`,
        embeds: ["widgets.trustpilot.com"],
      },
      {
        path: "/schedule",
        htmlKey: "schedule.html",
        html: `<html><body>
          <section><h2>Class schedule</h2>
            <iframe src="https://fitlab.pushpress.com/open/calendar?framed=1"></iframe>
          </section>
        </body></html>`,
        embeds: ["fitlab.pushpress.com"],
        dynamicRegions: [{ kind: "schedule", selector: "body", evidence: "text: class schedule" }],
      },
      {
        path: "/membership-pricing",
        htmlKey: "pricing.html",
        html: `<html><body>
          <section><h2>Membership inquiry</h2>
            <iframe src="https://api.grow.pushpress.com/widget/form/abc123"></iframe>
          </section>
        </body></html>`,
        embeds: ["api.grow.pushpress.com"],
        dynamicRegions: [{ kind: "booking-widget", selector: "iframe", evidence: "pushpress" }],
      },
      {
        path: "/contact",
        htmlKey: "contact.html",
        html: `<html><body>
          <iframe src="https://www.google.com/maps/embed?pb=abc" title="Find us"></iframe>
          <iframe src="https://sidebar.bugherd.com/sidebar/embed_html?apikey=x"></iframe>
        </body></html>`,
        embeds: ["www.google.com", "sidebar.bugherd.com"],
      },
    ]);

    const map = await extractCrawlPageIframes(crawl, s3, "bucket");

    expect(map.get("/")).toHaveLength(1);
    expect(map.get("/")?.[0]).toMatchObject({ src: "https://widgets.trustpilot.com/reviews/123", variant: "review" });

    expect(map.get("/schedule")).toHaveLength(1);
    expect(map.get("/schedule")?.[0]).toMatchObject({ src: "https://fitlab.pushpress.com/open/calendar?framed=1", variant: "schedule" });

    expect(map.get("/membership-pricing")).toHaveLength(1);
    expect(map.get("/membership-pricing")?.[0]).toMatchObject({ src: "https://api.grow.pushpress.com/widget/form/abc123", variant: "form" });

    // Contact page map is kept; the unrelated bug-tracker iframe (default variant) is dropped.
    expect(map.get("/contact")).toHaveLength(1);
    expect(map.get("/contact")?.[0]).toMatchObject({ src: "https://www.google.com/maps/embed?pb=abc", variant: "map" });
  });

  test("skips pages with no widget signals", async () => {
    const { crawl, s3 } = makeCrawlWithPages([
      {
        path: "/blog/article",
        htmlKey: "blog.html",
        html: "<html><body><p>About us</p></body></html>",
        embeds: [],
      },
    ]);
    const map = await extractCrawlPageIframes(crawl, s3, "bucket");
    expect(map.size).toBe(0);
    expect(s3.send).not.toHaveBeenCalled();
  });
});
