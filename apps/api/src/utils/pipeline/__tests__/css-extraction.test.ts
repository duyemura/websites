import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { serveFixture } from "../../../../test/fixtures/pipeline/serve-fixture";
import { extractCss } from "../css-extraction";

describe("extractCss", () => {
  let browser: Browser;
  let page: Page;
  let fixture: Awaited<ReturnType<typeof serveFixture>>;

  beforeAll(async () => {
    browser = await chromium.launch();
    fixture = await serveFixture("semantic");
    page = await browser.newPage();
    await page.goto(fixture.url);
  });
  afterAll(async () => {
    await browser.close();
    await fixture.close();
  });

  it("extracts :root custom properties as tokens", async () => {
    const css = await extractCss(page);
    expect(css.tokens["--brand"]).toBe("#e63946");
    expect(css.tokens["--bg"]).toBe("#ffffff");
  });

  it("extracts @media conditions as breakpoints", async () => {
    const css = await extractCss(page);
    expect(css.breakpoints).toContain("(max-width: 768px)");
  });

  it("extracts @keyframes into the animation inventory", async () => {
    const css = await extractCss(page);
    expect(css.animations.map((a) => a.name)).toContain("fadeIn");
  });
});
