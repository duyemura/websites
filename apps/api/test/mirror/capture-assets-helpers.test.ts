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

  it("skips third-party and data: sources", () => {
    const html = `<html><body><script src="https://widgets.mindbody.com/w.js"></script><img src="data:image/png;base64,AA"></body></html>`;
    expect(collectAssetUrls(html, "https://gym.com/", "https://gym.com")).toEqual([]);
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
});
