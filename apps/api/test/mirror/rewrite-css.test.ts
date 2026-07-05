import { describe, it, expect } from "vitest";
import { extractCssUrls, rewriteCssUrls } from "../../src/utils/mirror/rewrite-css";

describe("extractCssUrls", () => {
  it("extracts absolute URLs from url() refs resolved against the stylesheet URL", () => {
    const css = `body { background: url('/img/bg.jpg'); } @font-face { src: url("fonts/a.woff2") format("woff2"); }`;
    const urls = extractCssUrls(css, "https://gym.com/wp-content/style.css");
    expect(urls).toContain("https://gym.com/img/bg.jpg");
    expect(urls).toContain("https://gym.com/wp-content/fonts/a.woff2");
  });

  it("ignores data: URIs", () => {
    const css = `.x { background: url(data:image/png;base64,AAAA); }`;
    expect(extractCssUrls(css, "https://gym.com/style.css")).toEqual([]);
  });
});

describe("rewriteCssUrls", () => {
  it("rewrites mapped urls and leaves unmapped ones", () => {
    const css = `body { background: url('/img/bg.jpg'); } .y { background: url('/img/other.jpg'); }`;
    const map = new Map([["https://gym.com/img/bg.jpg", "/_assets/bg.jpg"]]);
    const out = rewriteCssUrls(css, "https://gym.com/style.css", map);
    expect(out).toContain("url('/_assets/bg.jpg')");
    expect(out).toContain("url('/img/other.jpg')");
  });
});
