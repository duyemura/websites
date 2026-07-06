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
    // negatives — must NOT be boilerplate
    ["/our-privacy-approach", "structural"],
    ["/legal-services", "structural"],
    ["/terms-of-fitness", "structural"],
    ["/cookies-recipe", "structural"],
    // additional positives — must be boilerplate
    ["/privacy", "boilerplate"],
    ["/cookie-policy", "boilerplate"],
    ["/accessibility-statement", "boilerplate"],
    ["/legal-notice", "boilerplate"],
  ])("classifies %s as %s", (path, expected) => {
    expect(classifyUrl(path, { collectionPrefixes: [] })).toBe(expected);
  });

  it("classifies collection members as ugc-instance", () => {
    expect(classifyUrl("/blog/5-tips-for-squats", { collectionPrefixes: ["/blog/"] })).toBe("ugc-instance");
  });

  it("does not classify hyphen-adjacent paths as ugc-instance", () => {
    // '/news-events' should NOT match /news/... prefix
    expect(classifyUrl("/news-events/leadership-summit", { collectionPrefixes: [] })).toBe("structural");
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

  it("merges sources, dedupes, ranks nav > footer > sitemap > sweep", () => {
    const withFooterOverlap = {
      ...inputs,
      footerLinks: [{ label: "About", href: "/about" }, { label: "Privacy", href: "/privacy" }],  // /about is also in nav
      sitemapUrls: ["https://example.com/", "https://example.com/about", "https://example.com/sitemap-only"],
    };
    const map = buildSiteMap(withFooterOverlap, { maxPages: 50 });
    // /about appears in nav AND footer AND sitemap — nav wins
    expect(map.find((e) => e.path === "/about")?.source).toBe("nav");
    // sitemap-only path stays sitemap-sourced
    expect(map.find((e) => e.path === "/sitemap-only")?.source).toBe("sitemap");
    // sweep-only path stays link-sweep-sourced
    expect(map.find((e) => e.path === "/contact")?.source).toBe("link-sweep");
  });

  it("captures exactly one collection exemplar and skips the rest", () => {
    const map = buildSiteMap(inputs, { maxPages: 50 });
    const exemplars = map.filter((e) => e.classification === "collection-exemplar");
    const skippedUgc = map.filter((e) => e.classification === "ugc-instance" && e.status === "skipped");
    expect(exemplars).toHaveLength(1);
    expect(skippedUgc.length).toBe(3);
    expect(skippedUgc.every((e) => e.skipReason === "user-generated-content")).toBe(true);
  });

  it("respects the maxPages cap", () => {
    const many = { ...inputs, sweepLinks: Array.from({ length: 80 }, (_, i) => `/landing-${i}`) };
    const map = buildSiteMap(many, { maxPages: 50 });
    const captured = map.filter((e) => e.status === "captured");
    expect(captured).toHaveLength(50);
    const overflow = map.filter((e) => e.status === "skipped" && e.skipReason === "page-cap-exceeded");
    expect(overflow.length).toBeGreaterThan(0);
  });
});
