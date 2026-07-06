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

    const container = section.querySelector(".container, article") ?? section;
    const all = Array.from(container.querySelectorAll("*"));
    const leafish = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement;
      // leaf-ish: no child elements or only one child text, and visible with size
      return rect.width > 80 && rect.height > 60 && el.children.length <= 4;
    });

    const groups: Record<string, Array<{ tag: string; class: string; text: string; rect: object; bg: string; childCount: number }>> = {};
    for (const el of leafish) {
      const rect = el.getBoundingClientRect();
      const key = `${Math.round(rect.top)}`;
      (groups[key] ??= []).push({
        tag: el.tagName,
        class: (el as HTMLElement).className,
        text: el.textContent?.trim().slice(0, 100) ?? "",
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        bg: window.getComputedStyle(el).backgroundColor,
        childCount: el.children.length,
      });
    }

    // Also dump top-level container children
    const containerChildren = Array.from(container.children).map((child) => {
      const rect = child.getBoundingClientRect();
      const s = window.getComputedStyle(child);
      return {
        tag: child.tagName,
        class: (child as HTMLElement).className,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        display: s.display,
        flexWrap: s.flexWrap,
        childCount: child.children.length,
        text: child.textContent?.trim().slice(0, 100) ?? "",
      };
    });

    return { containerChildren, groups };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
