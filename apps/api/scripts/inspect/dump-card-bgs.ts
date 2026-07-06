import { chromium } from "playwright";

const SOURCE_URL = "https://beanburito.github.io/free-intro-session-self-book-in-person/";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(SOURCE_URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const articles = Array.from(document.querySelectorAll("article.membership-benefit-item"));
    return articles.map((article) => {
      const title = article.querySelector("h3")?.textContent?.trim() ?? "";
      const bgs = Array.from(article.querySelectorAll(".mb-bg, [class*='gradient'], [class*='img']")).map((el) => ({
        tag: el.tagName,
        class: (el as HTMLElement).className,
        bg: window.getComputedStyle(el).backgroundColor,
        bgImage: window.getComputedStyle(el).backgroundImage,
      }));
      return { title, bgs };
    });
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
