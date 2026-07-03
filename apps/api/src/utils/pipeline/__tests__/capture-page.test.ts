import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { serveFixture } from "../../../../test/fixtures/pipeline/serve-fixture";
import { capturePage } from "../capture-page";

describe("capturePage", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  it(
    "captures rendered content from a semantic page",
    async () => {
      const fixture = await serveFixture("semantic");
      const context = await browser.newContext();
      const result = await capturePage(context, fixture.url);
      await context.close();
      await fixture.close();

      expect(result.content.title).toBe("Semantic Gym");
      expect(result.content.businessName).toBe("Semantic Gym"); // from JSON-LD
      expect(result.content.headings.some((h) => h.text === "Train Harder")).toBe(true);
      expect(result.content.navLinks.map((l) => l.href)).toContain("/about");
      expect(result.screenshots.full1440.byteLength).toBeGreaterThan(1000);
      expect(result.screenshots.vp375.byteLength).toBeGreaterThan(1000);
      expect(result.flags.isSpa).toBe(false);
    },
    60_000,
  );

  it(
    "captures JS-rendered content and sets SPA flag on the SPA fixture",
    async () => {
      const fixture = await serveFixture("spa");
      const context = await browser.newContext();
      const result = await capturePage(context, fixture.url);
      await context.close();
      await fixture.close();

      expect(result.content.rawText).toContain("Memberships from $99");
      expect(result.flags.isSpa).toBe(true);
      expect(result.flags.needsVisionSegmentation).toBe(true);
    },
    60_000,
  );

  it(
    "records responsive deltas across viewports",
    async () => {
      const fixture = await serveFixture("semantic");
      const context = await browser.newContext();
      const result = await capturePage(context, fixture.url);
      await context.close();
      await fixture.close();

      const featureDelta = result.responsive.find(
        (d) => d.selector.includes("features") && d.property === "flex-direction",
      );
      expect(featureDelta?.at1440).toBe("row");
      expect(featureDelta?.at375).toBe("column");
    },
    60_000,
  );
});
