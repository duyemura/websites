import { chromium } from "playwright";

const SOURCE_URL = "https://beanburito.github.io/free-intro-session-self-book-in-person/";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(SOURCE_URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h3")).filter((h) =>
      h.closest(".membership-benefit-item"),
    );
    return headings.map((h) => {
      const path: Array<{ tag: string; class: string; rect: object; hasIcon: boolean; hasBg: boolean }> = [];
      let el: HTMLElement | null = h.parentElement;
      while (el && el !== document.body) {
        const r = el.getBoundingClientRect();
        path.push({
          tag: el.tagName,
          class: el.className,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          hasIcon:
            el.querySelector("svg, img, picture, figure, [class*='icon'], [class*='svg']") !== null,
          hasBg:
            window.getComputedStyle(el).backgroundColor !== "rgba(0, 0, 0, 0)" &&
            window.getComputedStyle(el).backgroundColor !== "transparent",
        });
        el = el.parentElement;
      }
      return { title: h.textContent?.trim(), path };
    });
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
