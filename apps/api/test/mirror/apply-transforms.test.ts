import { describe, it, expect } from "vitest";
import { applyTransforms, pageGlobMatches } from "../../src/utils/mirror/apply-transforms";
import type { SiteTransformRecord } from "../../src/types/mirror";

const BASE = `<html><head><title>Old</title><meta name="description" content="old desc"></head><body><h1>Welcome to Gym</h1><img src="/a.jpg"><form action="/x"><input></form></body></html>`;

function t(partial: Partial<SiteTransformRecord> & { type: SiteTransformRecord["type"] }): SiteTransformRecord {
  return {
    uuid: "u1",
    ordinal: 1,
    pageGlob: "/*",
    selector: null,
    payload: {},
    status: "active",
    ...partial,
  };
}

describe("pageGlobMatches", () => {
  it("matches exact paths, wildcard, and prefix globs", () => {
    expect(pageGlobMatches("/", "/")).toBe(true);
    expect(pageGlobMatches("/", "/coaches")).toBe(false);
    expect(pageGlobMatches("/*", "/coaches")).toBe(true);
    expect(pageGlobMatches("/blog/*", "/blog/post-1")).toBe(true);
    expect(pageGlobMatches("/blog/*", "/coaches")).toBe(false);
  });
});

describe("applyTransforms", () => {
  it("meta-set updates title and description", () => {
    const res = applyTransforms(BASE, "/", [
      t({ type: "meta-set", payload: { title: "New Title" } }),
      t({ uuid: "u2", ordinal: 2, type: "meta-set", payload: { name: "description", content: "new desc" } }),
    ]);
    expect(res.html).toContain("<title>New Title</title>");
    expect(res.html).toContain('content="new desc"');
    expect(res.applied).toEqual(["u1", "u2"]);
  });

  it("jsonld-inject appends structured data to head", () => {
    const res = applyTransforms(BASE, "/", [
      t({ type: "jsonld-inject", payload: { json: { "@type": "LocalBusiness", name: "Gym" } } }),
    ]);
    expect(res.html).toContain('application/ld+json');
    expect(res.html).toContain('"LocalBusiness"');
  });

  it("text-replace edits matching element text", () => {
    const res = applyTransforms(BASE, "/", [
      t({ type: "text-replace", selector: "h1", payload: { find: "Welcome to Gym", replace: "Torrance Training Lab" } }),
    ]);
    expect(res.html).toContain("<h1>Torrance Training Lab</h1>");
  });

  it("attr-set sets attributes (alt text)", () => {
    const res = applyTransforms(BASE, "/", [
      t({ type: "attr-set", selector: "img", payload: { attr: "alt", value: "Gym interior" } }),
    ]);
    expect(res.html).toContain('alt="Gym interior"');
  });

  it("marks transforms whose selector matches nothing as stale, and does not fail", () => {
    const res = applyTransforms(BASE, "/", [
      t({ type: "attr-set", selector: ".does-not-exist", payload: { attr: "alt", value: "x" } }),
    ]);
    expect(res.stale).toEqual(["u1"]);
    expect(res.applied).toEqual([]);
  });

  it("skips transforms whose glob does not match the page, disabled ones, and page-replace", () => {
    const res = applyTransforms(BASE, "/coaches", [
      t({ type: "meta-set", pageGlob: "/", payload: { title: "Nope" } }),
      t({ uuid: "u2", type: "meta-set", status: "disabled", payload: { title: "Nope" } }),
      t({ uuid: "u3", type: "page-replace", payload: { artifactRef: "x" } }),
    ]);
    expect(res.html).toContain("<title>Old</title>");
    expect(res.applied).toEqual([]);
    expect(res.stale).toEqual([]);
  });

  it("applies transforms in ordinal order", () => {
    const res = applyTransforms(BASE, "/", [
      t({ uuid: "u2", ordinal: 2, type: "meta-set", payload: { title: "Second" } }),
      t({ uuid: "u1", ordinal: 1, type: "meta-set", payload: { title: "First" } }),
    ]);
    expect(res.html).toContain("<title>Second</title>");
  });
});
