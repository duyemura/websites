import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const URL = "http://localhost:4321/";
const OUT = path.resolve(import.meta.dirname, "./output/rendered-impact");

async function run() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "mobile.png"), fullPage: true });

  await browser.close();
  console.log(`Screenshots saved to ${OUT}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
