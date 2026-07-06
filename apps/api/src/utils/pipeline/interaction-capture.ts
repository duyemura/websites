import type { Page, Locator } from "playwright";

export interface RawInteractionCapture {
  id: string;
  trigger: "click" | "hover";
  selector: string;
  before: Buffer;
  after: Buffer;
  styleDiff: Array<{
    selector: string;
    property: string;
    before: string;
    after: string;
  }>;
  boundingBox: { x: number; y: number; width: number; height: number };
}

const CANDIDATE_SELECTORS = [
  "[aria-expanded]",
  "[aria-haspopup]",
  "details > summary",
  "[class*='hamburger']",
  "[class*='menu-toggle']",
  "[class*='accordion']",
  "[class*='tab']:not([class*='table'])",
  "nav [class*='dropdown']",
].join(", ");

const DIFF_PROPS = [
  "display",
  "visibility",
  "opacity",
  "max-height",
  "transform",
  "background-color",
];

export async function captureInteractions(
  page: Page,
  opts: { max?: number } = {},
): Promise<RawInteractionCapture[]> {
  const max = opts.max ?? 8;
  if (max === 0) return [];

  const captures: RawInteractionCapture[] = [];
  const handles = await page.locator(CANDIDATE_SELECTORS).all();

  for (const handle of handles.slice(0, max)) {
    try {
      const box = await handle.boundingBox();
      if (!box || box.width < 8 || box.height < 8) continue;

      // Region to screenshot: the trigger's parent container (interaction effects usually appear nearby).
      const parent = handle.locator("xpath=..");
      const parentBox = (await parent.boundingBox()) ?? box;
      const clip = padClip(parentBox, await pageSize(page));

      const stylesBefore = await snapshotSubtree(handle);
      const before = await page.screenshot({ clip });

      const trigger: "click" | "hover" = (await handle.getAttribute(
        "aria-haspopup",
      ))
        ? "hover"
        : "click";
      if (trigger === "hover") await handle.hover();
      else await handle.click({ timeout: 2000 });
      await page.waitForTimeout(300);

      // Re-measure: opened panels grow the region.
      const openBox = (await parent.boundingBox()) ?? parentBox;
      const after = await page.screenshot({
        clip: padClip(openBox, await pageSize(page)),
      });
      const stylesAfter = await snapshotSubtree(handle);

      // Reset: Escape, then click away.
      await page.keyboard.press("Escape");
      await page.mouse.click(1, 1);
      await page.waitForTimeout(200);

      captures.push({
        id: `int-${captures.length}`,
        trigger,
        selector: await uniqueSelector(handle),
        before,
        after,
        styleDiff: diffSnapshots(stylesBefore, stylesAfter),
        boundingBox: box,
      });
    } catch {
      continue; // detached element / blocked click — skip candidate, keep going
    }
  }
  return captures;
}

function padClip(
  box: { x: number; y: number; width: number; height: number },
  size: { width: number; height: number },
) {
  const pad = 24;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return {
    x,
    y,
    width: Math.min(size.width - x, box.width + pad * 2),
    height: Math.min(size.height - y, box.height + pad * 2),
  };
}

async function pageSize(page: Page) {
  return page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
}

async function snapshotSubtree(handle: Locator) {
  return handle.evaluate((el, props) => {
    const scope = el.parentElement ?? el;
    const results: Array<{ selector: string; styles: Record<string, string> }> =
      [];
    const all = [scope, ...Array.from(scope.querySelectorAll("*"))].slice(
      0,
      30,
    );
    all.forEach((node, i) => {
      const computed = getComputedStyle(node);
      const styles: Record<string, string> = {};
      for (const p of props) styles[p] = computed.getPropertyValue(p);
      results.push({ selector: `${node.tagName.toLowerCase()}[${i}]`, styles });
    });
    return results;
  }, DIFF_PROPS);
}

function diffSnapshots(
  before: Array<{ selector: string; styles: Record<string, string> }>,
  after: Array<{ selector: string; styles: Record<string, string> }>,
) {
  const diff: Array<{
    selector: string;
    property: string;
    before: string;
    after: string;
  }> = [];
  const afterMap = new Map(after.map((s) => [s.selector, s.styles]));
  for (const b of before) {
    const a = afterMap.get(b.selector);
    if (!a) continue;
    for (const [property, beforeVal] of Object.entries(b.styles)) {
      const afterVal = a[property];
      if (afterVal !== undefined && afterVal !== beforeVal) {
        diff.push({
          selector: b.selector,
          property,
          before: beforeVal,
          after: afterVal,
        });
      }
    }
  }
  return diff;
}

async function uniqueSelector(handle: Locator): Promise<string> {
  return handle.evaluate((el) => {
    if (el.id) return `#${el.id}`;
    const cls =
      typeof el.className === "string"
        ? el.className.trim().split(/\s+/)[0]
        : "";
    return cls ? `${el.tagName.toLowerCase()}.${cls}` : el.tagName.toLowerCase();
  });
}
