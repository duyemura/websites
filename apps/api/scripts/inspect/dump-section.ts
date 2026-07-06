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

    const path: Array<{ tag: string; class: string; id: string; height: number; display: string; bg: string; bgImage: string }> = [];
    let el: HTMLElement | null = target;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      const s = window.getComputedStyle(el);
      path.push({
        tag: el.tagName,
        class: el.className,
        id: el.id,
        height: Math.round(r.height),
        display: s.display,
        bg: s.backgroundColor,
        bgImage: s.backgroundImage,
      });
      el = el.parentElement;
    }

    // Find grids under the section ancestor
    let section = target;
    while (section && section !== document.body && section.tagName.toLowerCase() !== "section") {
      section = section.parentElement as HTMLElement;
    }
    if (!section || section === document.body) section = target;

    const grids: Array<{ tag: string; class: string; cols: string; rows: string; children: number; display: string }> = [];
    const stack: Element[] = [section];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const child of Array.from(cur.children)) {
        const cs = window.getComputedStyle(child);
        if (cs.display === "grid" || cs.display === "inline-grid") {
          grids.push({
            tag: child.tagName,
            class: (child as HTMLElement).className,
            cols: cs.gridTemplateColumns,
            rows: cs.gridTemplateRows,
            children: child.children.length,
            display: cs.display,
          });
        }
        stack.push(child);
      }
    }

    return { heading: target.textContent?.trim(), path, gridCount: grids.length, grids };
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
