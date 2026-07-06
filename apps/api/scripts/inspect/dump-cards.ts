import { chromium } from "playwright";

const SOURCE_URL = "https://beanburito.github.io/free-intro-session-self-book-in-person/";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(SOURCE_URL, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
    const target = headings.find((h) =>
      h.textContent?.toLowerCase().includes("everything you need to crush"),
    );
    if (!target) return { error: "heading not found" };

    let section = target;
    while (section && section !== document.body && section.tagName.toLowerCase() !== "section") {
      section = section.parentElement as HTMLElement;
    }
    if (!section || section === document.body) section = target;

    const cards: Array<{
      tag: string;
      class: string;
      text: string;
      rect: { x: number; y: number; w: number; h: number };
      bg: string;
      bgImage: string;
      hasSvg: boolean;
      hasImg: boolean;
      childCount: number;
    }> = [];

    const stack: Element[] = [section];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of Array.from(cur.children)) {
        const el = child as HTMLElement;
        const s = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        // only collect visible block-ish children directly or at one level deep with real content
        if (rect.width > 100 && rect.height > 80 && el.children.length >= 2) {
          cards.push({
            tag: el.tagName,
            class: el.className,
            text: el.textContent?.trim().slice(0, 120) ?? "",
            rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            bg: s.backgroundColor,
            bgImage: s.backgroundImage,
            hasSvg: el.querySelector("svg") !== null,
            hasImg: el.querySelector("img") !== null,
            childCount: el.children.length,
          });
        } else if (el.children.length > 0) {
          stack.push(el);
        }
      }
    }

    return {
      sectionTag: section.tagName,
      sectionClass: section.className,
      sectionRect: section.getBoundingClientRect(),
      cards,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
