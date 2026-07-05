import { describe, it, expect } from "vitest";
import { rewriteHtml } from "../../src/utils/mirror/rewrite-html";

const ctx = {
  pageUrl: "https://gym.com/coaches",
  origin: "https://gym.com",
  assetMap: new Map([
    ["https://gym.com/wp-content/style.css", "/_assets/style.css"],
    ["https://gym.com/img/hero.jpg", "/_assets/hero.jpg"],
  ]),
  forms: [{ formId: "f1", selector: "form" }],
  formEndpointBase: "/forms/site-123",
  noindex: false,
};

describe("rewriteHtml", () => {
  it("rewrites same-origin asset URLs from the asset map", () => {
    const html = `<html><head><link rel="stylesheet" href="https://gym.com/wp-content/style.css"></head><body><img src="/img/hero.jpg"></body></html>`;
    const out = rewriteHtml(html, ctx);
    expect(out).toContain('href="/_assets/style.css"');
    expect(out).toContain('src="/_assets/hero.jpg"');
  });

  it("rewrites same-origin links to relative paths and leaves external links alone", () => {
    const html = `<html><body><a href="https://gym.com/pricing">P</a><a href="https://instagram.com/gym">IG</a></body></html>`;
    const out = rewriteHtml(html, ctx);
    expect(out).toContain('href="/pricing"');
    expect(out).toContain('href="https://instagram.com/gym"');
  });

  it("rewrites form actions to the Ploy endpoint and injects a honeypot", () => {
    const html = `<html><body><form action="/contact.php" method="post"><input name="email"></form></body></html>`;
    const out = rewriteHtml(html, ctx);
    expect(out).toContain('action="/forms/site-123/f1"');
    expect(out).toContain('name="_hp"');
  });

  it("does not rewrite third-party script src", () => {
    const html = `<html><body><script src="https://widgets.mindbodyonline.com/w.js"></script></body></html>`;
    const out = rewriteHtml(html, ctx);
    expect(out).toContain('src="https://widgets.mindbodyonline.com/w.js"');
  });

  it("injects noindex meta when requested", () => {
    const html = `<html><head><title>x</title></head><body></body></html>`;
    const out = rewriteHtml(html, { ...ctx, noindex: true });
    expect(out).toContain('<meta name="robots" content="noindex"');
  });

  it("rewrites srcset entries via the asset map", () => {
    const map = new Map(ctx.assetMap);
    map.set("https://gym.com/img/hero-2x.jpg", "/_assets/hero-2x.jpg");
    const html = `<html><body><img srcset="/img/hero.jpg 1x, /img/hero-2x.jpg 2x"></body></html>`;
    const out = rewriteHtml(html, { ...ctx, assetMap: map });
    expect(out).toContain("/_assets/hero.jpg 1x");
    expect(out).toContain("/_assets/hero-2x.jpg 2x");
  });
});
