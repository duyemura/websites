import { describe, expect, it } from "vitest";
import { classifyUrl, buildSiteMap, detectCollections } from "../page-discovery";

describe("classifyUrl", () => {
  it.each([
    ["/", "structural"],
    ["/about", "structural"],
    ["/pricing", "structural"],
    ["/programs/crossfit", "structural"],
    ["/locations/downtown", "structural"],
    ["/blog", "structural"],            // blog INDEX is structural
    ["/privacy-policy", "boilerplate"],
    ["/terms", "boilerplate"],
  ])("classifies %s as %s", (path, expected) => {
    expect(classifyUrl(path, { collectionPrefixes: [] })).toBe(expected);
  });

  it("classifies collection members as ugc-instance", () => {
    expect(classifyUrl("/blog/5-tips-for-squats", { collectionPrefixes: ["/blog/"] })).toBe("ugc-instance");
  });
});

describe("detectCollections", () => {
  it("detects a path prefix with many similar children as a collection", () => {
    const paths = ["/blog", "/blog/post-1", "/blog/post-2", "/blog/post-3", "/blog/post-4", "/about"];
    expect(detectCollections(paths)).toEqual(["/blog/"]);
  });

  it("does not flag business subpages as collections when few children", () => {
    const paths = ["/programs", "/programs/crossfit", "/programs/yoga", "/about"];
    expect(detectCollections(paths)).toEqual([]);
  });
});

describe("buildSiteMap", () => {
  const inputs = {
    baseUrl: "https://example.com",
    sitemapUrls: ["https://example.com/", "https://example.com/about"],
    navLinks: [
      { label: "Home", href: "/" }, { label: "About", href: "/about" },
      { label: "Pricing", href: "/pricing" },
    ],
    footerLinks: [{ label: "Privacy", href: "/privacy" }],
    sweepLinks: ["/blog", "/blog/post-1", "/blog/post-2", "/blog/post-3", "/blog/post-4", "/contact"],
    pageTitles: {},
  };

  it("merges sources, dedupes, ranks nav > footer > sweep", () => {
    const map = buildSiteMap(inputs, { maxPages: 50 });
    const paths = map.filter((e) => e.status === "captured").map((e) => e.path);
    expect(paths.indexOf("/about")).toBeLessThan(paths.indexOf("/contact"));
    expect(paths).toContain("/blog");                    // index captured
  });

  it("captures exactly one collection exemplar and skips the rest", () => {
    const map = buildSiteMap(inputs, { maxPages: 50 });
    const exemplars = map.filter((e) => e.classification === "collection-exemplar");
    const skippedUgc = map.filter((e) => e.classification === "ugc-instance" && e.status === "skipped");
    expect(exemplars).toHaveLength(1);
    expect(skippedUgc.length).toBe(3);
    expect(skippedUgc[0].skipReason).toBe("user-generated-content");
  });

  it("respects the maxPages cap", () => {
    const many = { ...inputs, sweepLinks: Array.from({ length: 80 }, (_, i) => `/landing-${i}`) };
    const map = buildSiteMap(many, { maxPages: 50 });
    expect(map.filter((e) => e.status === "captured").length).toBeLessThanOrEqual(50);
  });
});
