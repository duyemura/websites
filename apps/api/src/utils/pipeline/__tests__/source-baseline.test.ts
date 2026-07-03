import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { serveFixture } from "../../../../test/fixtures/pipeline/serve-fixture";
import { runAxeBaseline, networkStatsFromCapture } from "../source-baseline";

describe("source-baseline", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it("runs axe against a page and returns violations", async () => {
    const fixture = await serveFixture("div-soup");
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    const result = await runAxeBaseline(page, "/");
    await page.close();
    await context.close();
    await fixture.close();

    expect(result.path).toBe("/");
    expect(Array.isArray(result.violations)).toBe(true);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("derives network stats from capture output", () => {
    const stats = networkStatsFromCapture("/", {
      totalBytes: 1000,
      requestCount: 5,
      imageBytes: 400,
    });
    expect(stats).toEqual({
      path: "/",
      totalBytes: 1000,
      requestCount: 5,
      imageBytes: 400,
    });
  });
});
