import { describe, it, expect } from "vitest";
import { resolveHtmlFile } from "../eval-loop";

describe("resolveHtmlFile", () => {
  it("resolves root to dist/index.html", () => {
    expect(resolveHtmlFile("/tmp/dist", "/")).toBe("/tmp/dist/index.html");
  });

  it("resolves directory routes to dist/{path}/index.html", () => {
    expect(resolveHtmlFile("/tmp/dist", "/about")).toBe("/tmp/dist/about/index.html");
  });

  it("resolves file-like routes to dist/{path}.html directly", () => {
    expect(resolveHtmlFile("/tmp/dist", "/pushpress-site-modern/index.html")).toBe(
      "/tmp/dist/pushpress-site-modern/index.html",
    );
  });
});
