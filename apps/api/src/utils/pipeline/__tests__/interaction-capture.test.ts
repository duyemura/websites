import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { serveFixture } from "../../../../test/fixtures/pipeline/serve-fixture";
import { captureInteractions } from "../interaction-capture";

describe("captureInteractions", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it("captures a details/summary accordion before and after click", async () => {
    const fixture = await serveFixture("semantic");
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });

    const interactions = await captureInteractions(page);
    await page.close();
    await fixture.close();

    expect(interactions.length).toBeGreaterThanOrEqual(1);
    const accordion = interactions[0];
    expect(accordion.trigger).toBe("click");
    expect(accordion.before.byteLength).toBeGreaterThan(100);
    expect(accordion.after.byteLength).toBeGreaterThan(100);
    // after-click, the details panel is open so the region is taller or content differs
    expect(accordion.after.equals(accordion.before)).toBe(false);
  });

  it("caps captures at the configured maximum", async () => {
    const fixture = await serveFixture("semantic");
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    const interactions = await captureInteractions(page, { max: 0 });
    await page.close();
    await fixture.close();
    expect(interactions).toHaveLength(0);
  });
});
