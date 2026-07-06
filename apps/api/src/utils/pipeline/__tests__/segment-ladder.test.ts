import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { serveFixture } from "../../../../test/fixtures/pipeline/serve-fixture";
import { semanticScan, visualBoundaryScan, runLadder } from "../segment-ladder";

describe("segment ladder", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser.close(); });

  it("rung 1 finds all landmark sections on the semantic fixture", async () => {
    const fixture = await serveFixture("semantic");
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    const candidates = await semanticScan(page);
    await page.close(); await fixture.close();

    // header, 3 sections, footer >= 5
    expect(candidates.length).toBeGreaterThanOrEqual(5);
    expect(candidates.every((c) => c.confidence === 0.9 && c.source === "semantic")).toBe(true);
    expect(candidates.every((c) => c.boundingBox.height > 0)).toBe(true);
  });

  it("rung 2 finds background-change boundaries on the div-soup fixture", async () => {
    const fixture = await serveFixture("div-soup");
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    const semantic = await semanticScan(page);
    expect(semantic.length).toBeLessThan(3);          // proves rung 1 is insufficient here

    const visual = await visualBoundaryScan(page);
    await page.close(); await fixture.close();

    // 4 background bands in the fixture
    expect(visual.length).toBeGreaterThanOrEqual(3);
    expect(visual.every((c) => c.source === "visual-boundary" && c.confidence === 0.6)).toBe(true);
  });

  it("runLadder invokes the vision fallback only when rungs 1+2 yield < 3", async () => {
    const fixture = await serveFixture("semantic");
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    let visionCalled = false;
    const result = await runLadder(page, {
      needsVisionSegmentation: false,
      visionSegment: async () => { visionCalled = true; return []; },
    });
    await page.close(); await fixture.close();

    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    expect(visionCalled).toBe(false);
    expect(result.ladder).toEqual({ rung1Count: result.candidates.length, rung2Used: false, visionUsed: false });
  });
});
