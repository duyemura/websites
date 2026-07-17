import { describe, it, expect } from "vitest";
import { normalizeBasePathname, normalizePagePath } from "../page-path";

describe("page-path normalization", () => {
  it("normalizes base pathnames", () => {
    expect(normalizeBasePathname("/")).toBe("/");
    expect(normalizeBasePathname("/pushpress-site-modern/")).toBe("/pushpress-site-modern/");
    expect(normalizeBasePathname("/pushpress-site-modern/index.html")).toBe("/pushpress-site-modern/");
    expect(normalizeBasePathname("/foo/page.html")).toBe("/foo/");
  });

  it("strips subpath base from root page", () => {
    expect(normalizePagePath("/pushpress-site-modern/index.html", "/pushpress-site-modern/")).toBe("/");
    expect(normalizePagePath("/pushpress-site-modern/", "/pushpress-site-modern/")).toBe("/");
  });

  it("strips subpath base from interior pages", () => {
    expect(normalizePagePath("/pushpress-site-modern/about", "/pushpress-site-modern/")).toBe("/about");
    expect(normalizePagePath("/pushpress-site-modern/about.html", "/pushpress-site-modern/")).toBe("/about");
    expect(normalizePagePath("/pushpress-site-modern/about/index.html", "/pushpress-site-modern/")).toBe("/about");
  });

  it("leaves already-canonical paths unchanged", () => {
    expect(normalizePagePath("/", "/")).toBe("/");
    expect(normalizePagePath("/about", "/")).toBe("/about");
    expect(normalizePagePath("/about/index.html", "/")).toBe("/about");
  });

  it("treats base-without-trailing-slash as root (redirect target case)", () => {
    expect(normalizePagePath("/pushpress-site-modern", "/pushpress-site-modern/")).toBe("/");
  });

  it("does not strip a path that starts with the same prefix as a different subpath", () => {
    expect(normalizePagePath("/pushpress-site-modern-blog/about", "/pushpress-site-modern/")).toBe("/pushpress-site-modern-blog/about");
  });
});
