import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("https://13abc1ed-preview.mygymseo.com/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/ttlab_scrolled.png" });
  await browser.close();
  console.log("done");
})();
