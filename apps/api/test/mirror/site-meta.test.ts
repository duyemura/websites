import { describe, it, expect } from "vitest";
import { generateSitemap, generateRobots, buildRedirectHtml } from "../../src/utils/mirror/site-meta";

describe("generateSitemap", () => {
  it("emits one url entry per page path against the given host", () => {
    const xml = generateSitemap("https://gym.com", ["/", "/coaches"]);
    expect(xml).toContain("<loc>https://gym.com/</loc>");
    expect(xml).toContain("<loc>https://gym.com/coaches</loc>");
    expect(xml).toContain("<urlset");
  });
});

describe("generateRobots", () => {
  it("allows all and points at the sitemap", () => {
    const txt = generateRobots("https://gym.com");
    expect(txt).toContain("User-agent: *");
    expect(txt).toContain("Sitemap: https://gym.com/sitemap.xml");
  });
});

describe("buildRedirectHtml", () => {
  it("builds a meta-refresh redirect page with canonical", () => {
    const html = buildRedirectHtml("/new-page");
    expect(html).toContain('url=/new-page');
    expect(html).toContain('rel="canonical"');
  });
});
