import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { chromium, type Browser } from "playwright";
import http from "node:http";
import { scrapeWebsite } from "../scrape-website";

const FIXTURE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Test Gym</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    section { padding: 4rem 1rem; }
  </style>
</head>
<body>
  <section id="hero" style="background: #f3f4f6; text-align: center;">
    <div style="max-width: 800px; margin: 0 auto;">
      <h1>Join Test Gym</h1>
      <p>The best gym in town for functional fitness and community training.</p>
      <a href="#cta" style="display: inline-block; padding: 0.75rem 1.5rem; background: #ef4444; color: #ffffff; text-decoration: none;">Start today</a>
    </div>
  </section>
  <section id="about" style="background: #ffffff;">
    <div style="max-width: 800px; margin: 0 auto;">
      <h2>About us</h2>
      <p>We offer world-class coaching and a welcoming community.</p>
    </div>
  </section>
</body>
</html>
`;

describe("scrapeWebsite section evidence", () => {
  let browser: Browser | undefined;
  let server: http.Server | undefined;
  let url: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(FIXTURE_HTML);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to start fixture server");
    }
    url = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("returns sections with bounding boxes and computed styles", async () => {
    const data = await scrapeWebsite(browser!, {
      url,
      takeScreenshot: false,
    });

    expect(data.sections?.length).toBeGreaterThan(0);
    const section = data.sections?.[0];
    expect(section).toBeDefined();
    expect(section?.visualEvidence).toBeDefined();
    expect(section?.visualEvidence.boundingBox.width).toBeGreaterThan(0);
    expect(section?.visualEvidence.boundingBox.height).toBeGreaterThan(0);
    expect(section?.visualEvidence.computedStyles.length).toBeGreaterThan(0);
    expect(section?.visualEvidence.domSnippet).toBeTruthy();
  });
});
