import { chromium } from "playwright";
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("https://13abc1ed-preview.mygymseo.com/", { waitUntil: "networkidle" });
  await page.evaluate(() => window.scrollTo(0, 500));
  await page.waitForTimeout(500);
  const html = await page.content();
  console.log('has header-cta', html.includes('header-cta'));
  const el = await page.$('a.header-cta');
  if (!el) { console.log('no a.header-cta'); }
  else {
    const styles = await el.evaluate((e) => {
      const cs = window.getComputedStyle(e);
      return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor, classes: e.className, parent: e.parentElement?.parentElement?.className };
    });
    console.log(JSON.stringify(styles, null, 2));
  }
  await browser.close();
})();
