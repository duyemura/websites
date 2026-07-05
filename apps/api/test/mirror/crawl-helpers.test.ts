import { describe, it, expect } from "vitest";
import { normalizeCrawlUrl, pathToSlug, classifyPath } from "../../src/services/mirror/crawl";

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

describe("classifyPath", () => {
  it("marks structural pages correctly", () => {
    // Top-level and nav pages are always structural
    expect(classifyPath("/")).toBe("structural");
    expect(classifyPath("/about")).toBe("structural");
    expect(classifyPath("/programs/crossfit-classes")).toBe("structural");
    expect(classifyPath("/coaches/john-doe")).toBe("structural");
    expect(classifyPath("/blog")).toBe("structural");       // index page is structural
    expect(classifyPath("/recipes")).toBe("structural");    // index page is structural
    expect(classifyPath("/pricing")).toBe("structural");
    expect(classifyPath("/local-guide")).toBe("structural");
  });

  it("marks UGC pages correctly", () => {
    // Individual posts/items within UGC collections
    expect(classifyPath("/blog/my-post-title")).toBe("ugc");
    expect(classifyPath("/blog/2026/january-update")).toBe("ugc");
    expect(classifyPath("/recipes/spinach-omelette")).toBe("ugc");
    expect(classifyPath("/articles/top-10-crossfit-tips")).toBe("ugc");
    expect(classifyPath("/news/gym-expansion-announcement")).toBe("ugc");
    expect(classifyPath("/posts/weekly-update")).toBe("ugc");
  });
});
