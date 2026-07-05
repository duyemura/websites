import { describe, it, expect } from "vitest";
import { collectAssetUrls, assetLocalName } from "../../src/services/mirror/capture-assets";

describe("collectAssetUrls", () => {
  it("collects same-origin stylesheets, scripts, images, and srcset entries", () => {
    const html = `<html><head><link rel="stylesheet" href="/style.css"><script src="/app.js"></script></head><body><img src="/a.jpg" srcset="/a.jpg 1x, /a@2x.jpg 2x"></body></html>`;
    const urls = collectAssetUrls(html, "https://gym.com/", "https://gym.com");
    expect(urls).toContain("https://gym.com/style.css");
    expect(urls).toContain("https://gym.com/app.js");
    expect(urls).toContain("https://gym.com/a.jpg");
    expect(urls).toContain("https://gym.com/a@2x.jpg");
  });

  it("NOW also collects third-party CDN assets — Webflow/Squarespace/Google Fonts — everything gets rehosted", () => {
    const html = `<html><head>
      <link rel="stylesheet" href="https://assets.website-files.com/abc/style.css">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <script src="https://www.googletagmanager.com/gtm.js?id=GTM-XXXX"></script>
    </head><body>
      <img src="https://images.squarespace-cdn.com/content/hero.jpg">
    </body></html>`;
    const urls = collectAssetUrls(html, "https://gym.com/", "https://gym.com");
    expect(urls).toContain("https://assets.website-files.com/abc/style.css");
    expect(urls).toContain("https://fonts.googleapis.com/css2?family=Inter");
    expect(urls).toContain("https://www.googletagmanager.com/gtm.js?id=GTM-XXXX");
    expect(urls).toContain("https://images.squarespace-cdn.com/content/hero.jpg");
  });

  it("still skips data: and blob: URIs", () => {
    const html = `<html><body>
      <img src="data:image/png;base64,AA">
      <video src="blob:https://gym.com/123"></video>
    </body></html>`;
    expect(collectAssetUrls(html, "https://gym.com/", "https://gym.com")).toHaveLength(0);
  });
});

describe("assetLocalName", () => {
  it("produces a stable hashed name preserving the extension", () => {
    const a = assetLocalName("https://gym.com/wp-content/theme/style.css");
    const b = assetLocalName("https://gym.com/wp-content/theme/style.css");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}\.css$/);
  });
  it("defaults to .bin when there is no extension", () => {
    expect(assetLocalName("https://gym.com/some/asset")).toMatch(/\.bin$/);
  });
  it("produces different hashes for different CDN URLs", () => {
    const webflow = assetLocalName("https://assets.website-files.com/abc/style.css");
    const local = assetLocalName("https://gym.com/style.css");
    expect(webflow).not.toBe(local);
  });
});
