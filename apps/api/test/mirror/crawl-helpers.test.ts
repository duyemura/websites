import { describe, it, expect } from "vitest";
import { normalizeCrawlUrl, pathToSlug } from "../../src/services/mirror/crawl";

describe("normalizeCrawlUrl", () => {
  const origin = "https://gym.com";
  it("keeps same-origin pages, strips fragments", () => {
    expect(normalizeCrawlUrl("https://gym.com/coaches#team", origin)).toBe("https://gym.com/coaches");
  });
  it("rejects cross-origin, assets, and non-http schemes", () => {
    expect(normalizeCrawlUrl("https://other.com/a", origin)).toBeNull();
    expect(normalizeCrawlUrl("https://gym.com/waiver.pdf", origin)).toBeNull();
    expect(normalizeCrawlUrl("mailto:x@y.com", origin)).toBeNull();
    expect(normalizeCrawlUrl("tel:555", origin)).toBeNull();
  });
  it("resolves relative URLs against a base", () => {
    expect(normalizeCrawlUrl("/pricing", origin, "https://gym.com/coaches")).toBe("https://gym.com/pricing");
  });
});

describe("pathToSlug", () => {
  it("converts paths to safe file slugs", () => {
    expect(pathToSlug("/")).toBe("index");
    expect(pathToSlug("/coaches")).toBe("coaches");
    expect(pathToSlug("/blog/post-1")).toBe("blog__post-1");
  });
});
